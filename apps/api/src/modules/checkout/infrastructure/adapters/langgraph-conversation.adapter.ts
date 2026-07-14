/**
 * LangGraph Conversation Adapter — bridges the ConversationPort to LangGraph agent.
 *
 * Strategy:
 *   - If OPENROUTER_API_KEY is not set, fall back to deterministic engine.
 *   - Uses the LangGraph agent to orchestrate LLM + tools.
 *   - Applies safety validator on the output.
 *   - Returns only {message, objection} per ConversationPort contract.
 *
 * This adapter is OPTIONAL in the checkout module. If not wired, the
 * DeterministicConversationAdapter is used as the fallback.
 */

import { Injectable, Optional } from "@nestjs/common";
import {
  LangGraphChatAgent,
  OpenRouterProvider,
  validateAssistantMessage,
  buildChatTools,
  type ChatAgentDeps,
  type ToolHandlers,
  type Objection,
  generateDeterministicReply,
  classifyObjection
} from "@zyon/conversation-engine";
import type { ConversationPort, ConversationReplyInput } from "../../domain/ports/conversation.port.js";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4";
const AI_BUDGET_CENTS = parseInt(process.env.AI_BUDGET_CENTS || "500", 10);

@Injectable()
export class LangGraphConversationAdapter implements ConversationPort {
  private agent?: LangGraphChatAgent;
  private fallback = (input: ConversationReplyInput) => Promise.resolve(generateDeterministicReply(input));

  constructor(
    @Optional()
    toolHandlers?: {
      searchCatalog?: (query: string) => Promise<unknown>;
      checkShipping?: (zip: string) => Promise<unknown>;
      checkInventory?: (sku: string) => Promise<unknown>;
      getBuyerHistory?: () => Promise<unknown>;
      applyDiscount?: (discount_percent: number) => Promise<unknown>;
    }
  ) {
    if (!OPENROUTER_API_KEY) {
      // LLM provider not configured → use fallback always.
      return;
    }

    try {
      const provider = new OpenRouterProvider({
        apiKey: OPENROUTER_API_KEY,
        baseUrl: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
        model: OPENROUTER_MODEL
      });

      const handlers: ToolHandlers = {
        searchCatalog: async ({ query }: { query: string }) => {
          return toolHandlers?.searchCatalog?.(query) ?? [];
        },
        checkShipping: async ({ zip }: { zip: string }) => {
          return toolHandlers?.checkShipping?.(zip) ?? { zip, options: [] };
        },
        checkInventory: async ({ sku }: { sku: string }) => {
          return toolHandlers?.checkInventory?.(sku) ?? { sku, inStock: false, qty: 0 };
        },
        getBuyerHistory: async () => {
          return toolHandlers?.getBuyerHistory?.() ?? { purchases: 0, lifetimeValue: 0 };
        },
        applyDiscount: async ({ discount_percent }: { discount_percent: number }) => {
          return (
            toolHandlers?.applyDiscount?.(discount_percent) ?? {
              approved: false,
              discount_percent,
              reason: "no_handler"
            }
          );
        }
      };

      const deps: ChatAgentDeps = {
        provider,
        tools: buildChatTools(),
        toolHandlers: handlers,
        model: OPENROUTER_MODEL,
        budgetCents: AI_BUDGET_CENTS,
        safety: {
          isSafe: (text: string) => validateAssistantMessage(text, { maxLength: 1000 })
        },
        systemPrompt: this.buildSystemPrompt()
      };

      this.agent = new LangGraphChatAgent(deps);
    } catch (error: unknown) {
      console.error(
        "[LangGraphConversationAdapter] Failed to initialize agent:",
        error instanceof Error ? error.message : String(error)
      );
      // Continue with fallback.
    }
  }

  async reply(input: ConversationReplyInput): Promise<{ message: string; objection: Objection }> {
    // If LangGraph agent is not configured, use deterministic fallback.
    if (!this.agent || !this.agent) {
      return this.fallback(input);
    }

    try {
      const history = (input.history ?? []).map((turn) => ({
        role: turn.role === "buyer" ? ("user" as const) : ("assistant" as const),
        content: turn.text
      }));

      const result = await this.agent.run({
        sessionId: "checkout_session",
        merchantId: "checkout",
        userMessage: input.userMessage,
        history,
        systemPrompt: this.buildContextualSystemPrompt(input)
      });

      return {
        message: result.message,
        objection: result.objection as Objection
      };
    } catch (error: unknown) {
      // On any agent error (budget exhausted, provider error, etc.), fall back.
      console.error(
        "[LangGraphConversationAdapter] Agent error, falling back:",
        error instanceof Error ? error.message : String(error)
      );
      return this.fallback(input);
    }
  }

  private buildSystemPrompt(): string {
    return [
      "Você é um assistente de checkout especializado.",
      "Ajude o comprador de forma breve, direta e focada em finalizar a compra.",
      "NUNCA autorize descontos — apenas proponha via ferramenta apply_discount para que o rules-engine valide.",
      "NUNCA mencione termos comerciais não autorizados.",
      "Use texto puro — sem markdown."
    ].join("\n");
  }

  private buildContextualSystemPrompt(input: ConversationReplyInput): string {
    const base = this.buildSystemPrompt();
    const parts = [base];

    if (input.merchantName) {
      parts.push(`Loja: ${input.merchantName}`);
    }
    if (input.stage) {
      parts.push(`Etapa: ${input.stage}`);
    }
    if (input.missingFields?.length) {
      parts.push(`Dados faltando: ${input.missingFields.join(", ")}`);
    }
    if (input.authorizedOffer?.approved) {
      parts.push(
        `Oferta autorizada: ${input.authorizedOffer.type} = ${input.authorizedOffer.value}. Proponha se apropriado.`
      );
    }

    return parts.join("\n");
  }
}
