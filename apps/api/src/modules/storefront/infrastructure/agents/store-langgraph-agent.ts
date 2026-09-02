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
import { buildConversationBlocks } from "./conversation-block.builder.js";

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

    const built = buildConversationBlocks({ toolResults, userMessage: input.userMessage, finalContent, merchantId: input.merchantId });
    blocks.push(...built.blocks);
    finalContent = built.finalContent;

    const hasProductCard = blocks.some(b => b.type === "product_card");
    const hasShippingOptions = blocks.some(b => b.type === "shipping_options");
    const hasComparison = blocks.some(b => b.type === "product_comparison");
    const removeCarousel = hasProductCard || hasShippingOptions || hasComparison;
    const finalBlocks = removeCarousel
      ? blocks.filter(b => b.type !== "product_carousel")
      : blocks;

    const messageToValidate = finalContent || FALLBACK_MESSAGE;

    // When list_promotions / get_daily_deals ran, the discounts they returned are
    // REAL (from the coupon repo / active product promotions). Authorize those
    // percentages so the safety validator doesn't reject the agent mentioning them
    // as if they were fabricated. Coupons/promos are authorized-by-existence.
    let authorizedDiscountPercent = 0;
    let freeShippingAuthorized = false;
    const promoResult = toolResults["list_promotions"] as
      | { coupons?: Array<{ type?: string; value?: number }>; progressive?: { maxPercent?: number } }
      | undefined;
    if (promoResult) {
      for (const c of promoResult.coupons ?? []) {
        if (c.type === "percent" && typeof c.value === "number") {
          authorizedDiscountPercent = Math.max(authorizedDiscountPercent, c.value);
        }
        if (typeof c.type === "string" && c.type.startsWith("shipping")) freeShippingAuthorized = true;
      }
      if (promoResult.progressive?.maxPercent) {
        authorizedDiscountPercent = Math.max(authorizedDiscountPercent, promoResult.progressive.maxPercent);
      }
    }
    const dealsResult = toolResults["get_daily_deals"] as { deals?: Array<{ discountPercent?: number }> } | undefined;
    if (dealsResult?.deals) {
      for (const d of dealsResult.deals) {
        if (typeof d.discountPercent === "number") authorizedDiscountPercent = Math.max(authorizedDiscountPercent, d.discountPercent);
      }
    }

    const safetyContext: StorefrontMessageContext = {
      toolResults,
      authorizedDiscountPercent,
      freeShippingAuthorized,
      shippingDiscountAuthorized: freeShippingAuthorized
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
