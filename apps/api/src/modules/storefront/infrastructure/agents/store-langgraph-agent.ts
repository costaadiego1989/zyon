/**
 * LangGraph store agent — orchestrates LLM + store tools with hybrid AI routing.
 *
 * Follows the same architecture as checkout conversation-engine:
 * - Pure domain (no NestJS imports)
 * - Provider injected (OpenRouterProvider)
 * - Tool-calling loop with result feeding back to LLM
 * - System prompt enforces no-hallucination on products/prices
 *
 * Enhanced with:
 * - Intent classification before LLM call (model routing)
 * - Cost tracking (token count after response)
 * - Safety validation on output (validates before sending to user)
 * - Fallback: if LLM call fails → return safe deterministic message
 */

import type {
  OpenRouterProvider,
  OpenRouterChatMessage,
  OpenRouterChatResult
} from "@zyon/conversation-engine";
import { ContextManager, DEFAULT_CONTEXT_WINDOW, CostTracker } from "@zyon/conversation-engine";
import { Logger } from "@nestjs/common";
import type { ExecutableTool, ToolDefinition } from "../../domain/tools/store-tools.js";
import { buildStoreTools, buildExecutableStoreTools } from "../../domain/tools/store-tools.js";
import type { ConversationBlock } from "../../domain/types/conversation-block.js";
import type { StoreToolHandlers } from "../../domain/tools/store-tools.js";
import { classifyIntent, getModelForIntent, type StoreAgentIntent, type ClassifyIntentResult } from "../ai/intent-classifier.js";
import { validateStorefrontMessage, type StorefrontMessageContext } from "../../domain/tools/safety-validator.js";
import { buildStoreSystemPrompt } from "../../domain/prompts/store-system-prompt.builder.js";

export interface StorefrontAgentCallbacks {
  onToken?: (token: string) => void;
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: unknown) => void;
  onIntentClassified?: (result: ClassifyIntentResult) => void;
  onModelRouted?: (tier: "fast" | "strong", intent: StoreAgentIntent) => void;
}

export interface StorefrontAgentDeps {
  provider: OpenRouterProvider;
  fallbackProvider?: OpenRouterProvider;
  toolHandlers: StoreToolHandlers;
  model?: string;
  fastModel?: string;
  strongModel?: string;
  budgetCents?: number;
  maxTurns?: number;
  systemPrompt?: string;
}

export interface StorefrontAgentInput {
  sessionId: string;
  merchantId: string;
  userMessage: string;
  cartId?: string;
  systemPrompt?: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  merchantName?: string;
  storeCategory: string;
  storeSettings?: Record<string, any>;
  agentIdentity?: { agentName?: string; persona?: string; tone?: string; greeting?: string; language?: string };
  merchantPolicy?: { maxDiscountPercent?: number; allowFreeShipping?: boolean; allowShippingDiscount?: boolean; freeShippingMinCartValue?: number; maxPartialShippingDiscount?: number; offerExpirationMinutes?: number };
  advancedRules?: string[];
  buyerContext?: { globalUserId: string; name?: string; phone?: string; email?: string };
  callbacks?: StorefrontAgentCallbacks;
  toolHandlers?: StoreToolHandlers;
}

export interface StorefrontAgentResult {
  message: string;
  blocks: ConversationBlock[];
  cartId?: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  toolsUsed: string[];
  routing: {
    intent: StoreAgentIntent;
    confidence: number;
    modelTier: "fast" | "strong";
    modelUsed: string;
  };
  safetyValidation: {
    safe: boolean;
    reason?: string;
  };
}

const MAX_TOOL_LOOPS = 5;
const DEFAULT_BUDGET_CENTS = 500;
const DEFAULT_MAX_TURNS = 20;

const FALLBACK_MESSAGE = "Como posso ajudá-lo com sua busca?";

const ERROR_FALLBACK_MESSAGES = [
  "Desculpe, tive um problema temporário. Como posso ajudá-lo?",
  "Tive uma dificuldade técnica. Pode repetir sua mensagem?",
  "Estou com uma limitação momentânea. Tente novamente em alguns instantes."
];

function getErrorFallback(): string {
  return ERROR_FALLBACK_MESSAGES[Math.floor(Math.random() * ERROR_FALLBACK_MESSAGES.length)];
}

export class StorefrontLangGraphAgent {
  private readonly logger = new Logger(StorefrontLangGraphAgent.name);
  private readonly provider: OpenRouterProvider;
  private readonly fallbackProvider: OpenRouterProvider | null;
  private readonly tools: ToolDefinition[];
  private readonly executableTools: ExecutableTool[];
  private readonly costTracker: CostTracker;
  private readonly contextManager: ContextManager;
  private readonly maxTurns: number;
  private readonly baseSystemPrompt: string;
  private readonly fastModel: string;
  private readonly strongModel: string;

  constructor(deps: StorefrontAgentDeps) {
    this.provider = deps.provider;
    this.fallbackProvider = deps.fallbackProvider ?? null;
    this.tools = buildStoreTools();
    this.maxTurns = deps.maxTurns ?? DEFAULT_MAX_TURNS;
    this.baseSystemPrompt = deps.systemPrompt ?? "";

    this.fastModel = deps.fastModel ?? deps.model ?? "anthropic/claude-sonnet-4";
    this.strongModel = deps.strongModel ?? "anthropic/claude-opus-4";

    this.costTracker = new CostTracker({
      budgetCents: deps.budgetCents ?? DEFAULT_BUDGET_CENTS,
      model: deps.model ?? "anthropic/claude-sonnet-4"
    });

    this.contextManager = new ContextManager({ maxTokens: DEFAULT_CONTEXT_WINDOW });

    const toolCtx = {
      merchantId: "",
      sessionId: "",
      handlers: deps.toolHandlers
    };
    this.executableTools = buildExecutableStoreTools(toolCtx);
  }

  async run(input: StorefrontAgentInput): Promise<StorefrontAgentResult> {
    if (!this.costTracker.canAfford(0.01)) {
      throw new Error("agent_budget_exhausted");
    }

    const intentResult = classifyIntent(input.userMessage);
    const modelTier = getModelForIntent(intentResult.intent);
    const modelUsed = modelTier === "fast" ? this.fastModel : this.strongModel;

    input.callbacks?.onIntentClassified?.(intentResult);
    input.callbacks?.onModelRouted?.(modelTier, intentResult.intent);

    const toolsUsed: string[] = [];
    const toolResults: Record<string, unknown> = {};
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalTokens = 0;
    const blocks: ConversationBlock[] = [];

    const executableTools = input.toolHandlers
      ? buildExecutableStoreTools({
          merchantId: input.merchantId,
          sessionId: input.sessionId,
          handlers: input.toolHandlers
        })
      : this.executableTools;

    const defaultSystem = buildStoreSystemPrompt({
      merchantName: input.merchantName,
      storeCategory: input.storeCategory,
      storeSettings: input.storeSettings,
      agentIdentity: input.agentIdentity,
      merchantPolicy: input.merchantPolicy,
      advancedRules: input.advancedRules,
      buyerContext: input.buyerContext,
    });
    const systemContent = input.systemPrompt
      ? `${input.systemPrompt}\n\n${defaultSystem}`
      : this.baseSystemPrompt || defaultSystem;
    // Limit history to last 10 messages to prevent context overflow that makes LLM skip tool calls
    const recentHistory = input.history.slice(-10);
    const rawMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system" as const, content: systemContent },
      ...recentHistory.map((h) => ({ role: h.role as "user" | "assistant", content: h.content })),
      { role: "user" as const, content: input.userMessage }
    ];

    const trimmed = this.contextManager.fromMessages(rawMessages);
    const messages: OpenRouterChatMessage[] = trimmed.map((m) => ({
      role: m.role as any,
      content: m.content
    }));

    let finalContent = "";
    let loops = 0;
    const openRouterTools = this.tools.map((t) => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.parameters }
    }));

    try {
      while (loops < MAX_TOOL_LOOPS) {
        loops += 1;

        const result: OpenRouterChatResult = await this.provider.chat({
          messages,
          tools: openRouterTools.length > 0 ? openRouterTools : undefined,
          temperature: 0.5,
          maxTokens: 1000
        });

        totalPromptTokens += result.usage.promptTokens;
        totalCompletionTokens += result.usage.completionTokens;
        totalTokens += result.usage.totalTokens;

        this.costTracker.record({
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens
        });

        if (result.toolCalls && result.toolCalls.length > 0) {
          messages.push({
            role: "assistant",
            content: result.content || "",
            tool_calls: result.toolCalls.map((tc) => ({
              id: tc.id,
              type: "function",
              function: { name: tc.name, arguments: JSON.stringify(tc.args) }
            }))
          } as any);

          for (const tc of result.toolCalls) {
            toolsUsed.push(tc.name);
            input.callbacks?.onToolCall?.(tc.name, tc.args);

            const execTool = executableTools.find((t) => t.name === tc.name);
            if (execTool) {
              const toolResult = await execTool.execute(tc.args);
              toolResults[tc.name] = toolResult.ok ? toolResult.data : { error: toolResult.error };
              input.callbacks?.onToolResult?.(tc.name, toolResult);

              messages.push({
                role: "tool",
                content: JSON.stringify(toolResult.ok ? toolResult.data : { error: toolResult.error }),
                name: tc.name,
                tool_call_id: tc.id
              });
            }
          }
          continue; // loop back to LLM with tool results
        }

        finalContent = result.content;
        break;
      }

      // ─── Fallback: if no tool was called but intent requires one, retry with strong model ───
      const TOOL_REQUIRED_PATTERNS = /^(categorias|ver todas|por preço|por avaliação|mais vendidos|novidades|frete grátis|por desconto|faq|falar com humano|ofertas do dia|ver avaliações|status do pedido)$/i;
      if (toolsUsed.length === 0 && TOOL_REQUIRED_PATTERNS.test(input.userMessage.trim())) {
        this.logger.warn("agent.no_tool_called.retry", { userMessage: input.userMessage.slice(0, 50), model: this.strongModel });
        try {
          const retryResult: OpenRouterChatResult = await this.provider.chat({
            messages,
            tools: openRouterTools.length > 0 ? openRouterTools : undefined,
            temperature: 0.3,
            maxTokens: 500,
            model: this.strongModel
          });
          totalPromptTokens += retryResult.usage.promptTokens;
          totalCompletionTokens += retryResult.usage.completionTokens;
          totalTokens += retryResult.usage.totalTokens;

          if (retryResult.toolCalls && retryResult.toolCalls.length > 0) {
            for (const tc of retryResult.toolCalls) {
              toolsUsed.push(tc.name);
              const execTool = executableTools.find((t) => t.name === tc.name);
              if (execTool) {
                const toolResult = await execTool.execute(tc.args);
                toolResults[tc.name] = toolResult.ok ? toolResult.data : { error: toolResult.error };
              }
            }
            // Get final text after tool execution
            messages.push({
              role: "assistant",
              content: retryResult.content || "",
              tool_calls: retryResult.toolCalls.map((tc) => ({
                id: tc.id,
                type: "function",
                function: { name: tc.name, arguments: JSON.stringify(tc.args) }
              }))
            } as any);
            for (const tc of retryResult.toolCalls) {
              const result = toolResults[tc.name];
              messages.push({ role: "tool", content: JSON.stringify(result), name: tc.name, tool_call_id: tc.id });
            }
            const finalResult = await this.provider.chat({ messages, temperature: 0.3, maxTokens: 200, model: this.strongModel });
            finalContent = finalResult.content;
            totalPromptTokens += finalResult.usage.promptTokens;
            totalCompletionTokens += finalResult.usage.completionTokens;
            totalTokens += finalResult.usage.totalTokens;
          } else {
            finalContent = retryResult.content || finalContent;
          }
        } catch (retryErr) {
          this.logger.error("agent.fallback_retry.failed", { error: retryErr instanceof Error ? retryErr.message : String(retryErr) });
          // Keep original finalContent
        }
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack?.slice(0, 300) : "";
      this.logger.error("agent.llm.failed", { error: errorMessage });

      if (this.fallbackProvider) {
        this.logger.warn("agent.fallback_provider.retry");
        try {
          const fbMessages: OpenRouterChatMessage[] = [
            { role: "system" as any, content: input.systemPrompt || this.baseSystemPrompt || buildStoreSystemPrompt({ merchantName: input.merchantName, storeCategory: input.storeCategory, storeSettings: input.storeSettings, agentIdentity: input.agentIdentity, merchantPolicy: input.merchantPolicy, advancedRules: input.advancedRules, buyerContext: input.buyerContext }) },
            ...input.history.map((h) => ({ role: h.role as any, content: h.content })),
            { role: "user" as any, content: input.userMessage }
          ];
          const openRouterTools = this.tools.map((t) => ({
            type: "function" as const,
            function: { name: t.name, description: t.description, parameters: t.parameters }
          }));

          let fbLoops = 0;
          let fbFinalContent = "";
          while (fbLoops < 3) {
            fbLoops++;
            const fbResult = await this.fallbackProvider.chat({
              messages: fbMessages,
              tools: openRouterTools.length > 0 ? openRouterTools : undefined,
              temperature: 0.4,
              maxTokens: 500
            });

            if (fbResult.toolCalls && fbResult.toolCalls.length > 0) {
              fbMessages.push({ role: "assistant", content: fbResult.content || "", tool_calls: fbResult.toolCalls.map((tc) => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: JSON.stringify(tc.args) } })) } as any);
              for (const tc of fbResult.toolCalls) {
                toolsUsed.push(tc.name);
                const execTool = executableTools.find((t) => t.name === tc.name);
                if (execTool) {
                  const toolResult = await execTool.execute(tc.args);
                  toolResults[tc.name] = toolResult.ok ? toolResult.data : { error: toolResult.error };
                  fbMessages.push({ role: "tool", content: JSON.stringify(toolResult.ok ? toolResult.data : { error: toolResult.error }), name: tc.name, tool_call_id: tc.id });
                }
              }
              continue;
            }
            fbFinalContent = fbResult.content;
            break;
          }
          finalContent = fbFinalContent;
          this.logger.log("agent.fallback_provider.success");
        } catch (fbErr) {
          this.logger.error("agent.fallback_provider.failed", { error: fbErr instanceof Error ? fbErr.message : String(fbErr) });
          finalContent = "";
          return {
            message: getErrorFallback(),
            blocks,
            cartId: input.cartId,
            usage: { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens, totalTokens },
            toolsUsed,
            routing: { intent: intentResult.intent, confidence: intentResult.confidence, modelTier, modelUsed },
            safetyValidation: { safe: true, reason: `both_providers_failed: ${errorMessage}` }
          };
        }
      } else {
        finalContent = "";
        return {
          message: getErrorFallback(),
          blocks,
          cartId: input.cartId,
          usage: { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens, totalTokens },
          toolsUsed,
          routing: { intent: intentResult.intent, confidence: intentResult.confidence, modelTier, modelUsed },
          safetyValidation: { safe: true, reason: `llm_error: ${errorMessage}` }
        };
      }
    }

    // ─── Build blocks from tool results ─────────────────────────────────
    // Skip product carousel when add_item_to_cart was called in the same turn
    // Skip the search carousel when search_products was used only to resolve a
    // product ID for a downstream action (add to cart, OR show full details).
    // Otherwise a detail request renders the carousel instead of the detailed card.
    const skipProductCarousel = !!toolResults["add_item_to_cart"] || !!toolResults["get_product_details"];
    // Auto-promote single search result to detailed card when the user intent was
    // "details/info" but the LLM only called search_products (not get_product_details).
    const isDetailIntent = /detalh|saber mais|informa[cç]|especifica|mais sobre|me fale|conte.*sobre/i.test(input.userMessage);
    const searchData = toolResults["search_products"] as any;
    const singleSearchAsDetail = !toolResults["get_product_details"] && isDetailIntent && searchData?.products?.length === 1;

    if (singleSearchAsDetail) {
      // Promote the single search result to a detailed product_card
      const p = searchData.products[0];
      const formatPrice = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
      const price = p.price ?? 0;
      blocks.push({
        type: "product_card",
        data: {
          id: p.id,
          name: p.name,
          description: p.description,
          price,
          priceFormatted: formatPrice(price),
          image: p.image,
          inStock: p.inStock ?? true,
          rating: p.rating ?? undefined,
          reviewCount: p.reviewCount ?? 0,
          detailed: true,
          stock: p.inStock ? undefined : 0,
          sku: p.variants?.[0]?.sku ?? p.variants?.[0]?.id,
          variants: p.variants?.map((v: any) => {
            const ATTR_LABELS: Record<string, string> = { color: "Cor", size: "Tamanho", material: "Material", weight: "Peso", style: "Estilo", flavor: "Sabor", voltage: "Voltagem", capacity: "Capacidade", model: "Modelo", edition: "Edição", pack: "Pacote", type: "Tipo", format: "Formato" };
            const rawName = Object.keys(v.attributes ?? {})[0] ?? "SKU";
            const name = ATTR_LABELS[rawName.toLowerCase()] ?? rawName;
            const value = Object.values(v.attributes ?? {})[0] as string ?? v.sku ?? v.id;
            return { id: v.id ?? v.sku, name, value, price: v.basePriceInCents ?? v.price ?? undefined, priceFormatted: v.basePriceInCents ? formatPrice(v.basePriceInCents) : undefined };
          }),
        }
      } as any);
      if (!finalContent || finalContent.trim().length === 0) {
        finalContent = "Aqui estão os detalhes completos:";
      }
    } else if (toolResults["search_products"] && !skipProductCarousel) {
      const searchData = toolResults["search_products"] as any;
      if (searchData?.products?.length > 0) {
        const formatPrice = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
        const isMarketplaceSource = searchData.source === "marketplace" || searchData.source === "mixed";
        blocks.push({
          type: "product_carousel",
          data: {
            products: searchData.products.map((p: any) => ({
              id: p.id,
              name: p.name,
              description: p.description,
              price: p.price,
              priceFormatted: formatPrice(p.price),
              image: p.image,
              images: p.images ?? (p.image ? [p.image] : []),
              inStock: p.inStock ?? true,
              rating: p.rating,
              reviewCount: p.reviewCount,
              variants: p.variants?.map((v: any) => {
                const ATTR_LABELS: Record<string, string> = { color: "Cor", size: "Tamanho", material: "Material", weight: "Peso", style: "Estilo", flavor: "Sabor", voltage: "Voltagem", capacity: "Capacidade", model: "Modelo", edition: "Edição", pack: "Pacote", type: "Tipo", format: "Formato" };
                const rawName = Object.keys(v.attributes ?? {})[0] ?? "SKU";
                const name = ATTR_LABELS[rawName.toLowerCase()] ?? rawName;
                const value = Object.values(v.attributes ?? {})[0] as string ?? v.sku ?? v.id;
                return { id: v.id ?? v.sku, name, value, price: v.basePriceInCents ?? v.price ?? undefined };
              }),
              source: p.source ?? (isMarketplaceSource ? "marketplace" : "local"),
              sellerName: p.sellerName ?? undefined,
              sellerMerchantId: p.sellerMerchantId,
            })),
            nextCursor: searchData.nextCursor,
            merchantId: input.merchantId,
            query: undefined,
            categoryId: undefined,
          }
        });
      }
    }
    // Skip product_card when get_similar_products was called in the same turn
    // (get_product_details was used only to resolve the product ID for similar lookup)
    const skipProductCard = !!toolResults["get_similar_products"] || !!toolResults["compare_products"];
    if (toolResults["get_product_details"] && !skipProductCard) {
      const detailData = toolResults["get_product_details"] as any;
      if (detailData?.product) {
        const p = detailData.product;
        const formatPrice = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
        const price = p.variants?.[0]?.basePriceInCents ?? p.price ?? 0;
        const isDigitalOrService = p.type === "digital" || p.type === "service";
        blocks.push({
          type: "product_card",
          data: {
            id: p.id,
            name: p.name,
            description: p.description,
            price,
            priceFormatted: formatPrice(price),
            image: p.media?.[0]?.url ?? p.image,
            inStock: isDigitalOrService || (p.stock ?? 0) > 0,
            rating: p.rating ?? 4.3,
            reviewCount: p.reviewCount ?? 0,
            // Detail view: get_product_details IS the "full info" tool, so render the
            // enriched card (untruncated description, per-variant stock, SKU).
            detailed: true,
            stock: isDigitalOrService ? 999 : (p.stock ?? 0),
            sku: p.variants?.[0]?.sku,
            variants: p.variants?.map((v: any) => {
              const ATTR_LABELS: Record<string, string> = { color: "Cor", size: "Tamanho", material: "Material", weight: "Peso", style: "Estilo", flavor: "Sabor", voltage: "Voltagem", capacity: "Capacidade", model: "Modelo", edition: "Edição", pack: "Pacote", type: "Tipo", format: "Formato", length: "Comprimento", width: "Largura", height: "Altura" };
              const rawName = Object.keys(v.attributes ?? {})[0] ?? "SKU";
              const name = ATTR_LABELS[rawName.toLowerCase()] ?? rawName;
              const value = Object.values(v.attributes ?? {})[0] as string ?? v.sku;
              const variantStock = isDigitalOrService ? 999 : Math.max(0, (v.stockQuantity ?? 0) - (v.stockReserved ?? 0));
              return { id: v.id ?? v.sku, name, value, sku: v.sku, stock: variantStock, price: v.basePriceInCents ?? undefined, priceFormatted: v.basePriceInCents ? formatPrice(v.basePriceInCents) : undefined };
            }),
          }
        });

        if (!finalContent || finalContent.trim().length === 0) {
          finalContent = "Aqui estão os detalhes completos:";
        }
      } else {
        finalContent = detailData?.error === "product_not_found"
          ? "Desculpe, não encontrei esse produto no catálogo. Posso ajudar com outra coisa?"
          : "Não consegui carregar os detalhes do produto. Tente novamente ou escolha outro produto.";
      }
    }
    const skipCartBlock = !!toolResults["quote_shipping"];
    if (toolResults["get_cart"] && !skipCartBlock) {
      const cartData = toolResults["get_cart"] as any;
      if (cartData?.items?.length > 0) {
        blocks.push({
          type: "cart_summary",
          data: {
            cartId: cartData.cartId,
            items: cartData.items.map((i: any) => ({
              variantId: i.variantId,
              productName: i.name,
              quantity: i.quantity,
              price: i.unitPrice,
              subtotal: i.lineTotal ?? i.unitPrice * i.quantity,
            })),
            itemCount: cartData.itemCount,
            subtotal: cartData.total,
            discount: cartData.discount,
            total: cartData.total - (cartData.discount ?? 0),
          }
        });
      }
    }
    if (toolResults["add_item_to_cart"] && !skipCartBlock) {
      const cartData = toolResults["add_item_to_cart"] as any;
      if (cartData?.items?.length > 0) {
        blocks.push({
          type: "cart_summary",
          data: {
            cartId: cartData.cartId,
            items: cartData.items.map((i: any) => ({
              variantId: i.variantId,
              productName: i.name,
              quantity: i.quantity,
              price: i.unitPrice,
              subtotal: i.lineTotal ?? i.unitPrice * i.quantity,
            })),
            itemCount: cartData.itemCount,
            subtotal: cartData.total,
            discount: 0,
            total: cartData.total,
          }
        });
      }
      if (cartData?.crossSellSuggestions?.length > 0) {
        const formatPrice = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
        blocks.push({
          type: "cross_sell",
          data: {
            trigger: "Complete seu pedido e economize — quem levou este produto também garantiu:",
            products: cartData.crossSellSuggestions.map((p: any) => ({
              id: p.sku,
              name: p.name,
              price: p.price,
              priceFormatted: formatPrice(p.price),
              image: p.imageUrl,
              inStock: true,
              discountPercent: p.discountPercent,
            })),
          }
        } as any);
      }
    }
    if (toolResults["quote_shipping"]) {
      const shippingData = toolResults["quote_shipping"] as any;
      if (shippingData?.options?.length > 0) {
        const formatPrice = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
        blocks.push({
          type: "shipping_options",
          data: {
            options: shippingData.options.map((o: any) => ({
              carrier: o.carrier,
              name: o.name,
              price: o.price,
              priceFormatted: formatPrice(o.price),
              days: o.days,
            }))
          }
        });
      }
    }
    if (toolResults["compare_products"]) {
      const compareData = toolResults["compare_products"] as any;
      if (compareData?.comparison?.length > 0) {
        const formatPrice = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
        blocks.push({
          type: "product_comparison",
          data: {
            products: compareData.comparison.map((p: any) => ({
              id: p.id,
              name: p.name,
              price: p.price,
              priceFormatted: formatPrice(p.price),
              rating: p.rating,
              inStock: p.type === "digital" || p.type === "service" || (p.stock ?? 0) > 0,
              attributes: p.attributes ?? {},
            }))
          }
        });
      }
    }
    const skipCategoryCarousel = !!toolResults["search_products"];
    if (toolResults["list_categories"] && !skipCategoryCarousel) {
      const catData = toolResults["list_categories"] as any;
      if (catData?.categories?.length > 0) {
        blocks.push({
          type: "category_carousel",
          data: {
            categories: catData.categories.map((c: any) => ({
              id: c.id,
              name: c.name,
              slug: c.slug,
              productCount: c.productCount ?? 0,
            }))
          }
        } as any);
      }
    }
    if (toolResults["get_reviews"]) {
      const reviewsData = toolResults["get_reviews"] as any;
      if (reviewsData?.reviews?.length > 0) {
        blocks.push({
          type: "reviews",
          data: {
            productId: "",
            productName: "",
            averageRating: reviewsData.averageRating ?? 4.5,
            totalReviews: reviewsData.totalCount ?? reviewsData.reviews.length,
            reviews: reviewsData.reviews.map((r: any) => ({
              id: r.id,
              author: r.author,
              rating: r.rating,
              text: r.text,
              date: r.date,
            })),
          }
        } as any);
      }
    }
    if (toolResults["get_similar_products"]) {
      const similarData = toolResults["get_similar_products"] as any;
      if (similarData?.products?.length > 0) {
        const formatPrice = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
        blocks.push({
          type: "cross_sell",
          data: {
            trigger: "similar",
            products: similarData.products.map((p: any) => ({
              id: p.id,
              name: p.name,
              price: p.price,
              priceFormatted: formatPrice(p.price),
              image: p.image,
              inStock: p.inStock ?? true,
            }))
          }
        } as any);
      }
    }
    if (toolResults["get_daily_deals"]) {
      const dealsData = toolResults["get_daily_deals"] as any;
      if (dealsData?.deals?.length > 0) {
        const formatPrice = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
        blocks.push({
          type: "product_carousel",
          data: {
            products: dealsData.deals.map((p: any) => ({
              id: p.id,
              name: p.name,
              price: p.price,
              priceFormatted: formatPrice(p.price),
              image: p.image,
              inStock: p.inStock ?? true,
              discountPercent: p.discountPercent,
            })),
            merchantId: input.merchantId,
          }
        });
      }
    }
    if (toolResults["create_checkout_session"]) {
      const checkoutData = toolResults["create_checkout_session"] as any;
      if (checkoutData?.checkoutUrl) {
        blocks.push({
          type: "checkout_redirect",
          data: {
            url: checkoutData.checkoutUrl,
            sessionId: checkoutData.sessionId ?? "",
          }
        } as any);
      }
    }

    const hasProductCard = blocks.some(b => b.type === "product_card");
    const hasShippingOptions = blocks.some(b => b.type === "shipping_options");
    const hasComparison = blocks.some(b => b.type === "product_comparison");
    const removeCarousel = hasProductCard || hasShippingOptions || hasComparison;
    const finalBlocks = removeCarousel
      ? blocks.filter(b => b.type !== "product_carousel")
      : blocks;

    const messageToValidate = finalContent || FALLBACK_MESSAGE;

    const safetyContext: StorefrontMessageContext = {
      toolResults,
      authorizedDiscountPercent: 0,
      freeShippingAuthorized: false,
      shippingDiscountAuthorized: false
    };

    const validation = validateStorefrontMessage(messageToValidate, safetyContext);

    if (validation.message && input.callbacks?.onToken) {
      input.callbacks.onToken(validation.message);
    }

    return {
      message: validation.message,
      blocks: finalBlocks,
      cartId: input.cartId,
      usage: { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens, totalTokens },
      toolsUsed,
      routing: {
        intent: intentResult.intent,
        confidence: intentResult.confidence,
        modelTier,
        modelUsed
      },
      safetyValidation: {
        safe: validation.safe,
        reason: validation.reason
      }
    };
  }
}
