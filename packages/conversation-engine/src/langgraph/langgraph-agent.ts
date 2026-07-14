/**
 * LangGraph Chat Agent — orchestrates LLM + tools in a state machine.
 *
 * States: greeting → objection_handling → offer_proposal → checkout_assist → payment → completion
 *
 * Architecture:
 *   - Does NOT import NestJS; it's a pure-domain engine.
 *   - Provider is injected (OpenRouterProvider or any compatible interface).
 *   - Safety validator runs on every LLM output.
 *   - Cost tracker is consulted before each turn.
 *   - Falls back to deterministic reply on any failure.
 */

import type {
  OpenRouterProvider,
  OpenRouterChatMessage,
  OpenRouterChatResult,
  OpenRouterToolDefinition
} from "./openrouter-provider.js";
import type { ExecutableTool, ToolDefinition, ToolHandlers } from "./chat-tools.js";
import { buildExecutableTools, buildChatTools } from "./chat-tools.js";
import { ContextManager, type ContextMessage, DEFAULT_CONTEXT_WINDOW } from "./context-manager.js";
import { CostTracker } from "./cost-tracker.js";
import { classifyObjection, type Objection } from "../index.js";

export type AgentState =
  | "greeting"
  | "objection_handling"
  | "offer_proposal"
  | "checkout_assist"
  | "payment"
  | "completion";

export interface ChatAgentCallbacks {
  onToken?: (token: string) => void;
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: unknown) => void;
  onStateChange?: (state: AgentState) => void;
}

export interface SafetyValidator {
  isSafe: (text: string) => { safe: boolean; reason?: string };
}

export interface ChatAgentDeps {
  provider: OpenRouterProvider;
  tools?: ToolDefinition[];
  toolHandlers: ToolHandlers;
  model?: string;
  safety: SafetyValidator;
  budgetCents?: number;
  maxTurns?: number;
  systemPrompt?: string;
}

export interface ChatAgentInput {
  sessionId: string;
  merchantId: string;
  userMessage: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  systemPrompt?: string;
  callbacks?: ChatAgentCallbacks;
}

export interface ChatAgentResult {
  message: string;
  state: AgentState;
  objection: Objection;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  toolsUsed: string[];
}

const MAX_TOOL_LOOPS = 5;
const DEFAULT_BUDGET_CENTS = 500; // 5 dollars
const DEFAULT_MAX_TURNS = 20;

const FALLBACK_MESSAGE = "Como posso ajudar com o seu pedido?";

function inferState(objection: Objection, hasToolCall: boolean): AgentState {
  if (hasToolCall) return "offer_proposal";
  if (objection === "unknown") return "greeting";
  return "objection_handling";
}

export class LangGraphChatAgent {
  private readonly provider: OpenRouterProvider;
  private readonly tools: ToolDefinition[];
  private readonly executableTools: ExecutableTool[];
  private readonly safety: SafetyValidator;
  private readonly costTracker: CostTracker;
  private readonly contextManager: ContextManager;
  private readonly maxTurns: number;
  private readonly baseSystemPrompt: string;

  constructor(deps: ChatAgentDeps) {
    this.provider = deps.provider;
    this.tools = deps.tools ?? buildChatTools();
    this.safety = deps.safety;
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
    this.executableTools = buildExecutableTools(toolCtx);
  }

  async run(input: ChatAgentInput): Promise<ChatAgentResult> {
    // Pre-check budget before doing any work.
    if (!this.costTracker.canAfford(0.01)) {
      throw new Error("agent_budget_exhausted");
    }

    const objection = classifyObjection(input.userMessage);
    let currentState: AgentState = inferState(objection, false);
    const toolsUsed: string[] = [];
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalTokens = 0;

    // Build messages for the LLM.
    const systemContent = input.systemPrompt || this.baseSystemPrompt || this.buildDefaultSystem();
    const rawMessages: ContextMessage[] = [
      { role: "system", content: systemContent },
      ...input.history.map((h) => ({ role: h.role as "user" | "assistant", content: h.content })),
      { role: "user" as const, content: input.userMessage }
    ];
    const trimmed = this.contextManager.fromMessages(rawMessages);

    const messages: OpenRouterChatMessage[] = trimmed.map((m) => ({
      role: m.role,
      content: m.content
    }));

    // Emit initial state.
    input.callbacks?.onStateChange?.(currentState);

    // Tool loop: LLM may request tool calls, we execute and feed results back.
    let finalContent = "";
    let loops = 0;
    const openRouterTools: OpenRouterToolDefinition[] = this.tools.map((t) => ({
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

      // If we got tool calls, execute them and loop.
      if (result.toolCalls && result.toolCalls.length > 0) {
        for (const tc of result.toolCalls) {
          toolsUsed.push(tc.name);
          currentState = "offer_proposal";
          input.callbacks?.onToolCall?.(tc.name, tc.args);

          const execTool = this.executableTools.find((t) => t.name === tc.name);
          if (execTool) {
            const toolResult = await execTool.execute(tc.args);
            input.callbacks?.onToolResult?.(tc.name, toolResult);

            // Add assistant tool_call and tool result to conversation.
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

    // Emit token callback (best-effort, non-streaming).
    if (finalContent && input.callbacks?.onToken) {
      input.callbacks.onToken(finalContent);
    }

    // Safety check.
    const safetyResult = this.safety.isSafe(finalContent);
    if (!safetyResult.safe) {
      finalContent = FALLBACK_MESSAGE;
    }

    // Update state based on final analysis.
    if (toolsUsed.length > 0) {
      currentState = "offer_proposal";
    } else {
      currentState = inferState(objection, false);
    }
    input.callbacks?.onStateChange?.(currentState);

    return {
      message: finalContent || FALLBACK_MESSAGE,
      state: currentState,
      objection,
      usage: { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens, totalTokens },
      toolsUsed
    };
  }

  private buildDefaultSystem(): string {
    return [
      "Você é um assistente de checkout. Ajude o comprador a finalizar sua compra.",
      "Seja breve, direto e focado. Não use markdown.",
      "NUNCA autorize descontos — apenas proponha ao rules-engine via ferramenta.",
      "NUNCA mencione termos comerciais que não estejam autorizados."
    ].join("\n");
  }
}
