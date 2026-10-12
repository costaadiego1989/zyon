import type { PrismaClient } from "@prisma/client";
import type { ChatExchangeClaim } from "../../checkout/domain/ports/checkout-session.repository.port.js";
import type { LlmCallResult } from "../../checkout/domain/services/checkout-chat-prompt.js";
import { chatMessageTextHash } from "../../checkout/application/services/chat-message-identity.js";
import { isSafeGeneratedMessage } from "../../checkout/domain/types/safe-generated-message.js";
import { PrismaCheckoutRepository } from "../../checkout/infrastructure/prisma/prisma-checkout.repository.js";
import { digest } from "../../experiments/domain/services/measurement-plan.js";
import { lockCheckoutBaselineRows } from "./checkout-baseline.reader.js";
import { currentStrategyTurnReason, executionClock } from "./strategy-execution-ledger.js";
import { checkoutNavigationBlocks, checkoutNavigationTools, MAIN_CHAT_PUBLICATION_POLICY, CHECKOUT_CHAT_NAVIGATION_MESSAGE } from "../../checkout/domain/services/checkout-chat-navigation.js";

/** Publication primitive. No provider/tool/payment I/O or client delivery
 * assertion. The main chat adapter returns committed text and pure navigation. */
export class StrategyChatPublisher {
  constructor(private readonly prisma: PrismaClient, private readonly clock = executionClock) {}

  async publish(input: { merchantId: string; sessionId: string; turnId: string; claim: ChatExchangeClaim;
    userMessage: string; result: LlmCallResult; mainChat?: true }) {
    input = structuredClone(input);
    const responseHash = digest(input.result);
    return this.prisma.$transaction(async tx => {
      await lockCheckoutBaselineRows(tx, input.merchantId);
      await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id = ${input.merchantId}
        AND session_id = ${input.sessionId} FOR UPDATE`;
      const turn = await tx.strategyTurn.findFirst({ where: { id: input.turnId, merchantId: input.merchantId },
        include: { completion: { include: { publication: true } }, assignment: { include: { execution: true } } } });
      const request = await tx.checkoutChatRequest.findFirst({ where: { id: input.claim.requestId,
        merchantId: input.merchantId, sessionId: input.sessionId, requestHash: input.claim.requestHash, protocolVersion: 2 } });
      if (!turn || !request || turn.chatRequestId !== request.id || turn.assignment.sessionId !== input.sessionId
        || turn.publicationPolicy !== (input.mainChat ? MAIN_CHAT_PUBLICATION_POLICY : "text_only_no_personalization_v1")
        || request.buyerMessageHash !== chatMessageTextHash(input.userMessage)) throw new Error("STRATEGY_PUBLICATION_REQUEST_CONFLICT");
      if (!turn.completion || turn.completion.responseHash !== responseHash) throw new Error("STRATEGY_PUBLICATION_RESPONSE_CONFLICT");
      if (turn.completion.publication) {
        // A receipt never replays an old message or commercial action.
        return { status: "already_decided" as const, publication: turn.completion.publication };
      }
      if (request.status !== "processing") throw new Error("STRATEGY_PUBLICATION_REQUEST_CONFLICT");
      const session = await tx.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: {
        merchantId: input.merchantId, sessionId: input.sessionId } } });
      const now = await this.clock(tx);
      const repository = new PrismaCheckoutRepository(tx, true);
      const snapshot = (await repository.getSession(input.merchantId, input.sessionId))!;
      const navigation = input.mainChat ? checkoutNavigationTools(input.result.toolCalls)
        : Array.isArray(input.result.toolCalls) && input.result.toolCalls.length === 0 ? [] : undefined;
      const blocks = navigation ? checkoutNavigationBlocks(navigation, snapshot) : [];
      const content = input.result.content;
      const text = typeof content === "string" ? content.replace(/^(?:Zion|Zyon)\s*:\s*/i, "") : "";
      // Keep a readable, recoverable agent turn even for tool-only responses.
      const message = text.trim() ? text : blocks.length ? CHECKOUT_CHAT_NAVIGATION_MESSAGE : "";
      let reason: string;
      if (process.env.REVENUE_STRATEGY_CHAT_PUBLICATION_ENABLED !== "true"
        || (input.mainChat && process.env.REVENUE_STRATEGY_MAIN_CHAT_ENABLED !== "true")) reason = "publication_disabled";
      else if (turn.completion.decision !== "eligible_at_recording") reason = "completion_suppressed";
      else if (!navigation
        || !message.trim() || message.length > 20_000) reason = "unsupported_response";
      // No offer is authorized by this primitive. Commercial tools and memory
      // personalization require their own atomic validation, not this filter.
      else if (!isSafeGeneratedMessage(message).safe) reason = "unsafe_message";
      else reason = await currentStrategyTurnReason(tx, turn, turn.assignment.execution, session, now);
      const base = { turnId: turn.id, merchantId: input.merchantId, sessionId: input.sessionId,
        requestId: request.id, responseHash };
      if (reason !== "current_at_recording") {
        const publication = await tx.strategyTurnPublication.create({ data: {
          ...base, decision: "suppressed", reason, recordedAt: await executionClock(tx) } });
        return { status: "suppressed" as const, publication };
      }
      const updated = await repository.appendChatExchange({ merchantId: input.merchantId, sessionId: input.sessionId,
        expectedSession: snapshot, claim: input.claim,
        buyer: { role: "buyer", text: input.userMessage, occurredAt: now.toISOString() },
        agent: { role: "agent", text: message, occurredAt: now.toISOString() } });
      const publication = await tx.strategyTurnPublication.create({ data: { ...base,
        decision: "persisted", reason: "current_at_publication", exchangeRequestId: request.id,
        ...(input.mainChat ? { navigationTools: navigation } : {}),
        agentTextHash: chatMessageTextHash(message), recordedAt: await this.clock(tx) } });
      return { status: "persisted" as const, publication, session: updated, message, blocks };
    });
  }
}
