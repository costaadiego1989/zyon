/**
 * LangGraph store agent — orchestrates LLM + store tools.
 *
 * Follows the same architecture as checkout conversation-engine:
 * - Pure domain (no NestJS imports)
 * - Provider injected (OpenRouterProvider)
 * - Tool-calling loop with result feeding back to LLM
 * - System prompt enforces no-hallucination on products/prices
 */

import type {
  OpenRouterProvider,
  OpenRouterChatMessage,
  OpenRouterChatResult
} from "@zyon/conversation-engine";
import { ContextManager, DEFAULT_CONTEXT_WINDOW, CostTracker } from "@zyon/conversation-engine";
import type { ExecutableTool, ToolDefinition } from "../../domain/tools/store-tools.js";
import { buildStoreTools, buildExecutableStoreTools } from "../../domain/tools/store-tools.js";
import type { ConversationBlock } from "../../domain/types/conversation-block.js";
import type { StoreToolHandlers } from "../../domain/tools/store-tools.js";

export interface StorefrontAgentCallbacks {
  onToken?: (token: string) => void;
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: unknown) => void;
}

export interface StorefrontAgentDeps {
  provider: OpenRouterProvider;
  toolHandlers: StoreToolHandlers;
  model?: string;
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
  callbacks?: StorefrontAgentCallbacks;
}

export interface StorefrontAgentResult {
  message: string;
  blocks: ConversationBlock[];
  cartId?: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  toolsUsed: string[];
}

const MAX_TOOL_LOOPS = 5;
const DEFAULT_BUDGET_CENTS = 500;
const DEFAULT_MAX_TURNS = 20;

const FALLBACK_MESSAGE = "Como posso ajudá-lo com sua busca?";

export class StorefrontLangGraphAgent {
  private readonly provider: OpenRouterProvider;
  private readonly tools: ToolDefinition[];
  private readonly executableTools: ExecutableTool[];
  private readonly costTracker: CostTracker;
  private readonly contextManager: ContextManager;
  private readonly maxTurns: number;
  private readonly baseSystemPrompt: string;

  constructor(deps: StorefrontAgentDeps) {
    this.provider = deps.provider;
    this.tools = buildStoreTools();
    this.maxTurns = deps.maxTurns ?? DEFAULT_MAX_TURNS;
    this.baseSystemPrompt = deps.systemPrompt ?? "";

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
    // Pre-check budget.
    if (!this.costTracker.canAfford(0.01)) {
      throw new Error("agent_budget_exhausted");
    }

    const toolsUsed: string[] = [];
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalTokens = 0;
    const blocks: ConversationBlock[] = [];

    // Build messages for LLM.
    const systemContent = input.systemPrompt || this.baseSystemPrompt || this.buildDefaultSystem(input.merchantName);
    const rawMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system" as const, content: systemContent },
      ...input.history.map((h) => ({ role: h.role as "user" | "assistant", content: h.content })),
      { role: "user" as const, content: input.userMessage }
    ];

    const trimmed = this.contextManager.fromMessages(rawMessages);
    const messages: OpenRouterChatMessage[] = trimmed.map((m) => ({
      role: m.role as any,
      content: m.content
    }));

    // Tool loop: LLM may call tools, we execute and feed results back.
    let finalContent = "";
    let loops = 0;
    const openRouterTools = this.tools.map((t) => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.parameters }
    }));

    while (loops < MAX_TOOL_LOOPS) {
      loops += 1;

      const result: OpenRouterChatResult = await this.provider.chat({
        messages,
        tools: openRouterTools.length > 0 ? openRouterTools : undefined,
        temperature: 0.5,
        maxTokens: 500
      });

      totalPromptTokens += result.usage.promptTokens;
      totalCompletionTokens += result.usage.completionTokens;
      totalTokens += result.usage.totalTokens;

      this.costTracker.record({
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens
      });

      // If tool calls, execute them.
      if (result.toolCalls && result.toolCalls.length > 0) {
        for (const tc of result.toolCalls) {
          toolsUsed.push(tc.name);
          input.callbacks?.onToolCall?.(tc.name, tc.args);

          const execTool = this.executableTools.find((t) => t.name === tc.name);
          if (execTool) {
            const toolResult = await execTool.execute(tc.args);
            input.callbacks?.onToolResult?.(tc.name, toolResult);

            // Add assistant and tool messages to conversation.
            messages.push({
              role: "assistant",
              content: result.content || `Calling ${tc.name}...`
            });
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

      // No tool calls → final answer.
      finalContent = result.content;
      break;
    }

    // Emit token callback.
    if (finalContent && input.callbacks?.onToken) {
      input.callbacks.onToken(finalContent);
    }

    return {
      message: finalContent || FALLBACK_MESSAGE,
      blocks,
      cartId: input.cartId,
      usage: { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens, totalTokens },
      toolsUsed
    };
  }

  private buildDefaultSystem(merchantName?: string): string {
    const name = merchantName ? ` da loja ${merchantName}` : "";
    return [
      `Você é um assistente de vendas${name}.`,
      "Ajude o cliente a encontrar produtos, comparar, adicionar ao carrinho e finalizar compra.",
      "Seja breve, direto e amigável. Não use markdown.",
      "",
      "REGRAS CRÍTICAS:",
      "- Use as ferramentas (search_products, get_product_details, compare_products, add_item_to_cart, etc.) para TODOS os dados de produto, preço e estoque.",
      "- NUNCA invente produtos, preços ou quantidades em estoque.",
      "- Se uma ferramenta falhar, diga ao cliente de forma clara e educada.",
      "- Sempre confirm ações do cliente: 'Quer adicionar 2 unidades ao carrinho?' antes de chamar add_item_to_cart.",
      "- Quando o cliente quiser finalizar, use create_checkout_session."
    ].join("\n");
  }
}
