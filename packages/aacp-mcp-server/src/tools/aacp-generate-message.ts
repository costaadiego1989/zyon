import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  generateDeterministicReply,
  isSafeGeneratedMessage
} from "@zyon/conversation-engine";
import type { AuthorizedOffer, Cart } from "@zyon/shared-types";
import { GenerateMessageInputSchema } from "../schemas.js";

/**
 * Registers `aacp_generate_message` on the given McpServer.
 *
 * Wraps @zyon/conversation-engine's deterministic reply generator. Always
 * runs through isSafeGeneratedMessage. If the message is unsafe, returns
 * a hard-coded deterministic safe fallback so callers never see forbidden
 * claims (delivery guarantees, stock guarantees, payment confirmations,
 * CVV/password requests, etc.).
 *
 * IMPORTANT: We intentionally do NOT call generateSalesReply (LLM-backed)
 * here. MCP servers must work offline. The LLM path requires API keys and
 * network and lives in the API server, not the MCP tool surface.
 */
export function registerGenerateMessage(server: McpServer): void {
  server.tool(
    "aacp_generate_message",
    "Generate a context-appropriate chat message for a buyer. Always runs through the safety validator; returns a deterministic safe fallback if the message would contain forbidden claims.",
    GenerateMessageInputSchema.shape,
    async (input) => {
      const { context } = input;

      // Build a minimal cart if we know the total, to feed the engine.
      const cart: Cart | undefined =
        context.cartTotal !== undefined
          ? {
              currency: context.currency,
              total: context.cartTotal,
              items: []
            }
          : undefined;

      const authorizedOffer: AuthorizedOffer | undefined = context.authorizedOffer
        ? ({
            approved: context.authorizedOffer.approved,
            type: context.authorizedOffer.type,
            value: context.authorizedOffer.value,
            id: "mcp-tool",
            merchantId: input.merchantId,
            sessionId: "mcp-tool",
            reason: "mcp_tool_authorized",
            marginAfterOffer: 0,
            expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
          } as AuthorizedOffer)
        : undefined;

      // Map our intent → conversation-engine userMessage triggers the right
      // objection classification (or no objection for greeting/recovery).
      const intentToUserMessage: Record<string, string> = {
        greeting: "ola",
        objection_discount: "esta caro demais, tem desconto?",
        objection_shipping: "o frete esta muito caro",
        cart_recovery: "vou pensar melhor"
      };

      const userMessage =
        context.userMessage ?? intentToUserMessage[input.intent] ?? "ola";

      const result = generateDeterministicReply({
        userMessage,
        brandVoice: context.brandVoice,
        authorizedOffer,
        merchantName: context.merchantName,
        cart,
        stage: context.stage,
        missingFields: context.missingFields
      });

      // Safety check ALWAYS runs. Merchant rules never bypass this gate.
      const safe = isSafeGeneratedMessage(result.message, authorizedOffer);

      const output = safe
        ? { message: result.message, fallbackUsed: false }
        : {
            message:
              "Posso te ajudar a finalizar com seguranca. Se nenhuma oferta for liberada, te mostro a alternativa mais segura para continuar.",
            fallbackUsed: true
          };

      return {
        content: [{ type: "text", text: JSON.stringify(output) }]
      };
    }
  );
}
