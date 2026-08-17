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
  agentIdentity?: { agentName?: string; persona?: string; tone?: string; greeting?: string };
  merchantPolicy?: { maxDiscountPercent?: number; allowFreeShipping?: boolean; allowShippingDiscount?: boolean; freeShippingMinCartValue?: number; maxPartialShippingDiscount?: number; offerExpirationMinutes?: number };
  advancedRules?: string[];
  callbacks?: StorefrontAgentCallbacks;
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

    const systemContent = input.systemPrompt || this.baseSystemPrompt || this.buildDefaultSystem(input.merchantName, input.storeCategory, input.storeSettings, input.agentIdentity, input.merchantPolicy, input.advancedRules);
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

            const execTool = this.executableTools.find((t) => t.name === tc.name);
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
              const execTool = this.executableTools.find((t) => t.name === tc.name);
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

      // ─── Fallback: retry with fallbackProvider (DeepSeek) if primary fails ───
      if (this.fallbackProvider) {
        this.logger.warn("agent.fallback_provider.retry");
        try {
          const fbMessages: OpenRouterChatMessage[] = [
            { role: "system" as any, content: input.systemPrompt || this.baseSystemPrompt || this.buildDefaultSystem(input.merchantName, input.storeCategory, input.storeSettings, input.agentIdentity, input.merchantPolicy, input.advancedRules) },
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
                const execTool = this.executableTools.find((t) => t.name === tc.name);
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
    // (search_products was used only to resolve the product ID, not to display results)
    const skipProductCarousel = !!toolResults["add_item_to_cart"];
    if (toolResults["search_products"] && !skipProductCarousel) {
      const searchData = toolResults["search_products"] as any;
      if (searchData?.products?.length > 0) {
        const formatPrice = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
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
              variants: p.variants,
            })),
            nextCursor: searchData.nextCursor,
            merchantId: input.merchantId,
            query: undefined,
            categoryId: undefined,
          }
        });
      }
    }
    if (toolResults["get_product_details"]) {
      const detailData = toolResults["get_product_details"] as any;
      if (detailData?.product) {
        const p = detailData.product;
        const formatPrice = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
        const price = p.variants?.[0]?.basePriceInCents ?? p.price ?? 0;
        blocks.push({
          type: "product_card",
          data: {
            id: p.id,
            name: p.name,
            description: p.description,
            price,
            priceFormatted: formatPrice(price),
            image: p.media?.[0]?.url ?? p.image,
            inStock: (p.stock ?? 0) > 0,
            rating: p.rating ?? 4.3,
            reviewCount: p.reviewCount ?? 0,
            variants: p.variants?.map((v: any) => ({ id: v.id ?? v.sku, name: Object.keys(v.attributes ?? {})[0] ?? "SKU", value: Object.values(v.attributes ?? {})[0] ?? v.sku })),
          }
        });
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
              inStock: (p.stock ?? 0) > 0,
              attributes: p.attributes ?? {},
            }))
          }
        });
      }
    }
    if (toolResults["list_categories"]) {
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

    // Filter blocks: exclusive views remove carousel noise
    const hasProductCard = blocks.some(b => b.type === "product_card");
    const hasShippingOptions = blocks.some(b => b.type === "shipping_options");
    const hasComparison = blocks.some(b => b.type === "product_comparison");
    const removeCarousel = hasProductCard || hasShippingOptions || hasComparison;
    const finalBlocks = removeCarousel
      ? blocks.filter(b => b.type !== "product_carousel")
      : blocks;

    // ─── Safety validation ────────────────────────────────────────────────
    const messageToValidate = finalContent || FALLBACK_MESSAGE;

    const safetyContext: StorefrontMessageContext = {
      toolResults,
      authorizedDiscountPercent: 0,
      freeShippingAuthorized: false,
      shippingDiscountAuthorized: false
    };

    const validation = validateStorefrontMessage(messageToValidate, safetyContext);

    // Emit token callback.
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

  private buildDefaultSystem(merchantName?: string, storeCategory?: string, storeSettings?: Record<string, any>, agentIdentity?: { agentName?: string; persona?: string; tone?: string; greeting?: string }, merchantPolicy?: { maxDiscountPercent?: number; allowFreeShipping?: boolean; allowShippingDiscount?: boolean; freeShippingMinCartValue?: number; maxPartialShippingDiscount?: number; offerExpirationMinutes?: number }, advancedRules?: string[]): string {
    const name = merchantName ? ` da loja ${merchantName}` : "";
    const agentNameLabel = agentIdentity?.agentName || "Assistente";
    const categoryContext = storeCategory && storeCategory !== "others"
      ? `\nEsta é uma loja do segmento "${storeCategory}". Todos os produtos são exclusivamente deste segmento. NUNCA sugira ou mencione produtos fora deste segmento.`
      : "";

    // Company context for grounding
    let companyContext = "";
    if (storeSettings?.company) {
      const c = storeSettings.company;
      const parts: string[] = [];
      if (c.razaoSocial) parts.push(`Empresa: ${c.razaoSocial}`);
      if (c.cnpj) parts.push(`CNPJ: ${c.cnpj}`);
      if (c.address?.city && c.address?.state) parts.push(`Localização: ${c.address.city}/${c.address.state}`);
      if (c.businessHours) parts.push(`Horário: ${c.businessHours}`);
      if (c.phone) parts.push(`Contato: ${c.phone}`);
      if (parts.length > 0) companyContext = `\nSobre a empresa: ${parts.join(". ")}.`;
    }

    // Policies context
    let policiesContext = "";
    if (storeSettings?.policies) {
      const p = storeSettings.policies;
      const pols: string[] = [];
      if (p.returns) pols.push(`Devolução: ${p.returns.slice(0, 200)}`);
      if (p.shipping) pols.push(`Envio: ${p.shipping.slice(0, 200)}`);
      if (pols.length > 0) policiesContext = `\nPolíticas: ${pols.join(". ")}.`;
    }

    // Persona context
    let personaContext = "";
    if (agentIdentity?.persona) {
      personaContext = `\nSua personalidade: ${agentIdentity.persona}.`;
    }

    // Merchant policy context (discount/shipping limits)
    let policyContext = "";
    if (merchantPolicy) {
      const policyParts: string[] = [];
      if (merchantPolicy.maxDiscountPercent != null) policyParts.push(`Desconto máximo permitido: ${merchantPolicy.maxDiscountPercent}%`);
      if (merchantPolicy.allowFreeShipping != null) policyParts.push(`Frete grátis ${merchantPolicy.allowFreeShipping ? "permitido" : "NÃO permitido"}`);
      if (merchantPolicy.allowShippingDiscount != null) policyParts.push(`Desconto no frete ${merchantPolicy.allowShippingDiscount ? "permitido" : "NÃO permitido"}`);
      if (merchantPolicy.freeShippingMinCartValue != null && merchantPolicy.freeShippingMinCartValue > 0) policyParts.push(`Valor mínimo para frete grátis: R$ ${(merchantPolicy.freeShippingMinCartValue / 100).toFixed(2)}`);
      if (merchantPolicy.maxPartialShippingDiscount != null && merchantPolicy.maxPartialShippingDiscount > 0) policyParts.push(`Desconto máximo no frete: ${merchantPolicy.maxPartialShippingDiscount}%`);
      if (merchantPolicy.offerExpirationMinutes != null) policyParts.push(`Ofertas expiram em ${merchantPolicy.offerExpirationMinutes} minutos`);
      if (policyParts.length > 0) policyContext = `\nLIMITES DE NEGOCIAÇÃO: ${policyParts.join(". ")}.`;
    }

    return [
      `Você é ${agentNameLabel}, assistente de vendas${name}.${categoryContext}${companyContext}${policiesContext}${personaContext}${policyContext}`,
      "Ajude o cliente a encontrar produtos, comparar, adicionar ao carrinho e finalizar compra.",
      `Seja breve, direto e ${agentIdentity?.tone || "amigável"}. Não use markdown nem tabelas — a interface renderiza os dados visualmente.`,
      "",
      "REGRAS CRÍTICAS:",
      "- Use as ferramentas para TODOS os dados. NUNCA invente produtos, preços ou estoque.",
      "- Seja MINIMALISTA nas respostas de texto. A UI renderiza cards, carrosséis e tabelas automaticamente a partir dos dados das ferramentas.",
      "- Quando usar search_products: responda apenas 'Encontrei esses produtos para você:' (a UI mostra o carrossel).",
      "- Quando usar get_product_details: responda apenas 'Aqui estão os detalhes:' (a UI mostra o card completo).",
      "- Quando pedirem 'Calcular frete': use quote_shipping com o CEP informado. Se não tem CEP, peça o CEP ao cliente — NÃO peça pra adicionar ao carrinho primeiro.",
      "- Quando pedirem 'Ver variações': use get_product_details e responda 'Aqui estão as variações disponíveis:' (UI mostra selector).",
      "- Quando pedirem 'Comparar': use compare_products com o produto + similares da mesma categoria. Responda 'Comparação:' (UI mostra tabela).",
      "- Quando pedirem 'Calcular frete': peça o CEP. Quando o cliente enviar o CEP, use search_products com o nome do produto para obter o ID, depois chame quote_shipping com productId e zipCode. NUNCA diga que precisa adicionar ao carrinho.",
      "- Quando pedirem 'Ver avaliações': responda com avaliações se houver, senão diga que ainda não há avaliações.",
      "- Quando pedirem 'Tirar dúvida': NÃO despeje todas as informações. Apenas diga 'Claro, pode perguntar!' e ESPERE a próxima mensagem do cliente pra responder objetivamente.",
      "- Quando o cliente fizer uma PERGUNTA sobre o produto: responda APENAS a pergunta específica com base nos dados. Seja conciso.",
      "- Quando pedirem 'Ver categorias': use list_categories. Responda 'Nossas categorias:' (UI mostra cards).",
      "- Quando o cliente quiser finalizar, use create_checkout_session.",
      "- IMPORTANTE: Quando o histórico da conversa mostra um produto que foi consultado anteriormente, use esse contexto. Busque pelo nome do produto com search_products se precisar do ID.",
      "",
      "GUIA DE QUICK REPLIES (opções pré-configuradas que o cliente pode clicar):",
      "- 'Ver Produtos' → use search_products com query '*' para listar produtos disponíveis. NÃO use list_categories.",
      "- 'Encontrar Produto' → peça ao cliente o nome/tipo do produto, depois use search_products com a query informada.",
      "- 'Categorias' → use list_categories. Responda 'Aqui estão nossas categorias:'.",
      "- 'Ver produtos de [Categoria]' → use search_products com categoryId da categoria mencionada. NÃO liste categorias novamente.",
      "- 'Prazo de Entrega' → peça o CEP ao cliente. Depois use quote_shipping.",
      "- 'Trocas e Devoluções' → use get_store_policies com policyType 'returns'. Responda com a política da loja.",
      "- 'Rastrear Pedido' → Peça o número/ID do pedido ao cliente. Depois use track_order.",
      "- 'Meus Dados' → use get_buyer_profile. Responda com as informações disponíveis.",
      "- 'Ofertas' ou 'Promoções' → use get_daily_deals. Responda 'Aqui estão nossas ofertas:'.",
      "- 'Selecionar Produto' → Pergunte qual produto quer ver. Use get_product_details com o ID.",
      "- 'Filtrar Produtos' → Pergunte critério (preço, avaliação, etc). Use search_products com sortBy.",
      "- 'Ofertas do Dia' → use get_daily_deals. A UI mostra carrossel com badges de desconto.",
      "- 'Mais Informações' → use get_product_details. Foque na info solicitada (specs, material, etc).",
      "- 'Ver Avaliações' → use get_reviews com productId. A UI mostra bloco de reviews.",
      "- 'Tirar Dúvidas' → use get_product_questions ou diga 'Pode perguntar!' e ESPERE.",
      "- 'Comparar' → use compare_products. A UI mostra tabela comparativa.",
      "- 'Lista de Desejos' → use add_to_wishlist ou get_wishlist conforme contexto.",
      "- 'Produtos Semelhantes' → use get_similar_products. A UI mostra cross-sell block.",
      "- 'Escrever Avaliação' → Para criar avaliação, o cliente PRECISA informar nome e telefone. Peça o nome primeiro e depois o telefone no formato (11) 99999-9999. Se a mensagem contém [nome:X|tel:Y], extraia os dados e use create_review com authorName=X e authorPhone=Y. Se NÃO contém esses dados, peça nome e telefone antes de prosseguir.",
      "- 'Fazer Pergunta' → use create_question. Peça a pergunta ao cliente.",
      "- 'FAQ' → use get_faq. Responda com as perguntas frequentes.",
      "- 'Falar com Humano' → use escalate_to_human. Confirme o encaminhamento.",
      "- 'Nota Fiscal' → use get_invoice com orderId. Retorne o link.",
      "- 'Cancelar Pedido' → use cancel_order. Peça confirmação antes.",
      "- 'Garantia' → use get_store_policies com policyType 'warranty'.",
      "",
      "ADICIONAR AO CARRINHO — REGRA OBRIGATÓRIA (NUNCA IGNORE):",
      "- SEMPRE que o cliente menciona 'Adicionar', 'adicionar', 'carrinho' na mensagem: OBRIGATÓRIO chamar add_item_to_cart.",
      "- Passo 1: use search_products com o nome do produto para obter o ID.",
      "- Passo 2: use add_item_to_cart com variantId = campo 'id' do primeiro resultado de search_products, quantity = 1.",
      "- NUNCA responda sem chamar add_item_to_cart quando o cliente pede para adicionar.",
      "- NUNCA diga que adicionou sem ter chamado a tool add_item_to_cart.",
      "- Se o produto já apareceu no resultado de search_products anterior na MESMA conversa, pode usar o ID direto sem buscar novamente.",
      "- NÃO peça confirmação — adicione direto.",
      "- Após add_item_to_cart retornar sucesso: responda EXATAMENTE '{nome_do_produto} adicionado ao carrinho!'",
      "- Se retornar error: responda 'Não consegui adicionar. Tente novamente.'",
      "",
      "VER CARRINHO — REGRA OBRIGATÓRIA:",
      "- Quando o cliente diz 'Ver carrinho' ou 'Ver meu carrinho': use get_cart. A UI mostra o drawer lateral automaticamente.",
      "",
      "COMPRAR AGORA — REGRA OBRIGATÓRIA:",
      "- Quando o cliente diz 'Comprar X' ou 'Comprar agora': faça o mesmo que 'Adicionar ao carrinho' E depois use create_checkout_session com o cartId retornado.",
      "- Responda: 'Redirecionando para o pagamento...' (a UI redireciona automaticamente).",
      "",
      "NUNCA peça confirmação de cor/tamanho/variante a não ser que o cliente pergunte explicitamente. Use a variante padrão (primeira disponível).",
      "",
      "REGRA ABSOLUTA DE TOOL-CALLING:",
      "- Quando o cliente pede uma AÇÃO (ver produtos, categorias, ofertas, FAQ, avaliações, comparar, etc), você DEVE chamar a ferramenta correspondente NA MESMA RESPOSTA.",
      "- NUNCA responda 'Deixa eu verificar', 'Vou buscar', 'Um momento' SEM chamar a ferramenta. Isso é proibido.",
      "- Se não tem contexto suficiente (ex: qual produto?), PERGUNTE em uma frase curta. Não diga que vai verificar.",
      "- Se o quick reply é uma ação direta (Categorias, FAQ, Ofertas do Dia, Por Preço, Mais Vendidos, Falar com Humano), EXECUTE a tool imediatamente sem perguntar nada.",
      "",
      "IMPORTANTE: Quando o cliente diz 'Ver produtos' ou pede para listar produtos, SEMPRE use search_products (com query '*' se necessário). NUNCA responda com categorias quando o pedido é por PRODUTOS.",
      "",
      // Advanced rules from merchant checkout settings
      ...(advancedRules && advancedRules.length > 0 ? [
        "REGRAS CONFIGURADAS PELO MERCHANT (siga durante a conversa — primeira que encaixar é a que vale):",
        ...advancedRules.map((r, i) => `${i + 1}. ${r}`),
        "IMPORTANTE: O motor de regras valida descontos. Se oferecer desconto acima do permitido, o sistema rejeita. Mantenha-se dentro dos valores das regras.",
        "",
      ] : []),
    ].join("\n");
  }
}
