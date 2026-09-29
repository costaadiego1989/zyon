import { ServiceUnavailableException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import type { ChatMessageRequest, ChatMessageResponse, ChatStage, CheckoutSession } from "@zyon/shared-types";
import type { ChatExchangeClaim } from "../../domain/ports/checkout-session.repository.port.js";
import type { SafeAuthorizedOffer } from "../../domain/types/safe-authorized-offer.js";
import { chatPaymentSelection } from "../../domain/services/chat-payment-selection.js";
import { deriveChatStage, missingFieldsForStage } from "../../domain/services/customer-extraction.service.js";
import { strategyExecutionEnabled } from "../../../revenue-manager/domain/strategy-execution.js";
import { executionClock, lockExecutionMerchant, StrategyExecutionLedger } from "../../../revenue-manager/infrastructure/strategy-execution-ledger.js";
import { chatMessageTextHash } from "../../domain/services/chat-message-identity.js";
import { StrategyChatDispatcher } from "../../../revenue-manager/application/strategy-chat-dispatcher.js";
import { StrategyChatPublisher } from "../../../revenue-manager/infrastructure/strategy-chat-publisher.js";
import type { ChatLlmGatewayService } from "./chat-llm-gateway.service.js";
import { strategyChatContextExit } from "../../domain/services/strategy-chat-context-exit.js";
import { assertCheckoutChatBaseline } from "../../domain/services/checkout-chat-baseline.js";
import { digest } from "../../../experiments/domain/services/measurement-plan.js";
import { toCheckoutSession } from "../../infrastructure/prisma/checkout-session.mapper.js";
import type { StrategyExecutionContract } from "../../../revenue-manager/domain/strategy-execution.js";

/** Narrow, disabled-by-default connection to the real chat. Once an assignment
 * owns a primary turn, no legacy provider/tool/payment fallback is allowed.
 * Deterministic checkout routes remain the caller's responsibility. */
export class StrategyCheckoutChatService {
  private readonly dispatcher: StrategyChatDispatcher;
  private readonly publisher: StrategyChatPublisher;

  constructor(private readonly prisma: PrismaClient, gateway: Pick<ChatLlmGatewayService, "callPinned">,
    private readonly clock = executionClock) {
    this.dispatcher = new StrategyChatDispatcher(new StrategyExecutionLedger(prisma), gateway);
    this.publisher = new StrategyChatPublisher(prisma);
  }

  /** Only a fresh, durable request may leave a terminal/expired experiment or
   * a permanently stopped assignment (for example after verified recognition).
   * Membership remains immutable for measurement. This is never a fallback
   * after dispatch: existing or uncertain attempts keep their original receipt. */
  async continueWithoutExperiment(request: ChatMessageRequest, claim?: ChatExchangeClaim): Promise<boolean> {
    return this.prisma.$transaction(async tx => {
      const owner = await tx.strategyAssignment.findUnique({ where: { merchantId_sessionId: {
        merchantId: request.merchant_id, sessionId: request.session_id } }, include: { execution: true, stop: true } });
      if (!owner) return false;
      const now = await this.clock(tx);
      if (!owner.stop && owner.execution.status === "running" && now < owner.execution.endsAt) return false;
      if (!claim) throw new Error("STRATEGY_CHAT_REQUEST_REQUIRED");
      const stored = await tx.checkoutChatRequest.findFirst({ where: { id: claim.requestId,
        merchantId: request.merchant_id, sessionId: request.session_id, requestHash: claim.requestHash,
        conversationId: request.conversation_id, messageId: request.message_id,
        buyerMessageHash: chatMessageTextHash(request.user_message), status: "processing", protocolVersion: 2 },
        include: { strategyTurn: true, exchange: true } });
      if (!stored || stored.strategyTurn || stored.exchange) throw new Error("STRATEGY_CONTINUATION_REQUEST_CONFLICT");
      // Execution status/horizon and assignment stops are terminal in PostgreSQL.
      // Restoring an identity or starting another test cannot reactivate membership.
      return true;
    });
  }

  async tryReply(input: { request: ChatMessageRequest; claim?: ChatExchangeClaim; session: CheckoutSession; beforeOffer: CheckoutSession;
    stage: ChatStage; previousStage: ChatStage; offer: SafeAuthorizedOffer;
    hasBuyerIntent: boolean; hasPreSearchedProducts: boolean; cryptoEnabled?: boolean }): Promise<ChatMessageResponse | { continueWithoutExperiment: true } | undefined> {
    // Snapshot mutable request/session inputs; keep no callback capable of effects.
    const value = structuredClone(input);
    const { request, session, claim } = value;
    const owner = await this.prisma.strategyAssignment.findUnique({ where: { merchantId_sessionId: {
      merchantId: request.merchant_id, sessionId: request.session_id } }, select: { id: true } });
    if (!owner) return undefined;
    if (process.env.REVENUE_STRATEGY_MAIN_CHAT_ENABLED !== "true" || !strategyExecutionEnabled(request.merchant_id)) {
      throw new ServiceUnavailableException({ code: "STRATEGY_MAIN_CHAT_DISABLED" });
    }
    if (!claim || request.merchant_id !== session.merchantId || request.session_id !== session.sessionId
      || request.conversation_id !== session.conversationId) throw new Error("STRATEGY_CHAT_REQUEST_REQUIRED");
    if (chatPaymentSelection(request.user_message, value.stage)
      || value.stage !== deriveChatStage(session) || !["shipping", "payment"].includes(value.stage)
      || (value.previousStage === "shipping" && value.stage === "payment")) {
      throw new ServiceUnavailableException({ code: "STRATEGY_MAIN_CHAT_CONTEXT_UNSUPPORTED" });
    }
    const exitReason = strategyChatContextExit(value);
    if (exitReason) {
      await this.stopBeforeDispatch(request, claim, value.beforeOffer, exitReason);
      return { continueWithoutExperiment: true };
    }
    const candidate = await this.dispatcher.dispatch({ merchantId: request.merchant_id, sessionId: request.session_id,
      route: "primary_llm", requestKey: claim.requestId, chatRequest: claim, userMessage: request.user_message,
      expectedSession: session, mainChat: true });
    if (candidate.status !== "candidate") throw new ServiceUnavailableException({ code: "STRATEGY_MAIN_CHAT_NO_CANDIDATE" });
    const publication = await this.publisher.publish({ merchantId: request.merchant_id, sessionId: request.session_id,
      claim, turnId: candidate.turnId, userMessage: request.user_message, result: candidate.result, mainChat: true });
    if (publication.status !== "persisted") throw new ServiceUnavailableException({ code: "STRATEGY_MAIN_CHAT_NOT_PUBLISHED" });
    // Text and history already committed together. Never invoke the normal
    // response builder here: it appends again and can create a payment intent.
    const stage = deriveChatStage(publication.session);
    return { message: publication.message, objection: "unknown", actions: [], turns: publication.session.chatHistory,
      ...(publication.blocks.length ? { blocks: publication.blocks } : {}),
      stage, missing_fields: missingFieldsForStage(publication.session, stage) };
  }

  /** A fresh, unconsumed request is the only exit proof. Serialize with admission
   * and publication; never transform a provider failure or a stale cart into a
   * second call through normal checkout. The stop is permanent and arm-neutral. */
  private async stopBeforeDispatch(request: ChatMessageRequest, claim: ChatExchangeClaim, expected: CheckoutSession,
    reason: NonNullable<ReturnType<typeof strategyChatContextExit>>) {
    await this.prisma.$transaction(async tx => {
      await lockExecutionMerchant(tx, request.merchant_id);
      await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id = ${request.merchant_id}
        AND session_id = ${request.session_id} FOR UPDATE`;
      const owner = await tx.strategyAssignment.findUnique({ where: { merchantId_sessionId: {
        merchantId: request.merchant_id, sessionId: request.session_id } }, include: { execution: true, session: true } });
      if (!owner) throw new Error("STRATEGY_ASSIGNMENT_REQUIRED");
      const contract = owner.execution.contract as unknown as StrategyExecutionContract;
      if (digest(contract) !== owner.execution.contractHash) throw new Error("STRATEGY_EXECUTION_CORRUPT");
      assertCheckoutChatBaseline(contract.baseline, request.merchant_id);
      // Consented intent is ephemeral server context, never a persisted buyer
      // profile in this comparison or in the reason recorded below.
      const { buyerIntent: _intent, ...snapshot } = expected as CheckoutSession & { buyerIntent?: unknown };
      if (digest(JSON.parse(JSON.stringify(snapshot))) !== digest(JSON.parse(JSON.stringify(toCheckoutSession(owner.session))))) {
        throw new Error("STRATEGY_SESSION_CONTEXT_CONFLICT");
      }
      await tx.$queryRaw`SELECT id FROM checkout_chat_requests WHERE id = ${claim.requestId}
        AND merchant_id = ${request.merchant_id} AND session_id = ${request.session_id} FOR UPDATE`;
      const stored = await tx.checkoutChatRequest.findFirst({ where: { id: claim.requestId,
        merchantId: request.merchant_id, sessionId: request.session_id, requestHash: claim.requestHash,
        conversationId: request.conversation_id, messageId: request.message_id,
        buyerMessageHash: chatMessageTextHash(request.user_message), status: "processing", protocolVersion: 2 },
        include: { strategyTurn: true, exchange: true } });
      if (!stored || stored.strategyTurn || stored.exchange || owner.session.conversationId !== request.conversation_id
        || await tx.checkoutChatRequest.findFirst({ where: { merchantId: request.merchant_id, sessionId: request.session_id,
          id: { not: claim.requestId }, status: { in: ["processing", "unknown"] } } })) {
        throw new Error("STRATEGY_CONTINUATION_REQUEST_CONFLICT");
      }
      await tx.strategyAssignmentStop.createMany({ data: [{ assignmentId: owner.id, merchantId: request.merchant_id,
        reason, stoppedAt: await this.clock(tx) }], skipDuplicates: true });
    });
  }
}
