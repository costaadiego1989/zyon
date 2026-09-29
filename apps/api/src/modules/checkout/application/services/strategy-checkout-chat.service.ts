import { ServiceUnavailableException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import type { ChatMessageRequest, ChatMessageResponse, ChatStage, CheckoutSession } from "@zyon/shared-types";
import type { ChatExchangeClaim } from "../../domain/ports/checkout-session.repository.port.js";
import type { SafeAuthorizedOffer } from "../../domain/types/safe-authorized-offer.js";
import { chatPaymentSelection } from "../../domain/services/chat-payment-selection.js";
import { deriveChatStage, missingFieldsForStage } from "../../domain/services/customer-extraction.service.js";
import { strategyExecutionEnabled } from "../../../revenue-manager/domain/strategy-execution.js";
import { executionClock, StrategyExecutionLedger } from "../../../revenue-manager/infrastructure/strategy-execution-ledger.js";
import { chatMessageTextHash } from "../../domain/services/chat-message-identity.js";
import { StrategyChatDispatcher } from "../../../revenue-manager/application/strategy-chat-dispatcher.js";
import { StrategyChatPublisher } from "../../../revenue-manager/infrastructure/strategy-chat-publisher.js";
import type { ChatLlmGatewayService } from "./chat-llm-gateway.service.js";

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

  /** Only a fresh, durable request may leave a terminal/expired experiment.
   * Membership remains immutable for measurement. This is never a fallback
   * after dispatch: existing or uncertain attempts keep their original receipt. */
  async continueWithoutExperiment(request: ChatMessageRequest, claim?: ChatExchangeClaim): Promise<boolean> {
    return this.prisma.$transaction(async tx => {
      const owner = await tx.strategyAssignment.findUnique({ where: { merchantId_sessionId: {
        merchantId: request.merchant_id, sessionId: request.session_id } }, include: { execution: true } });
      if (!owner) return false;
      const now = await this.clock(tx);
      if (owner.execution.status === "running" && now < owner.execution.endsAt) return false;
      if (!claim) throw new Error("STRATEGY_CHAT_REQUEST_REQUIRED");
      const stored = await tx.checkoutChatRequest.findFirst({ where: { id: claim.requestId,
        merchantId: request.merchant_id, sessionId: request.session_id, requestHash: claim.requestHash,
        conversationId: request.conversation_id, messageId: request.message_id,
        buyerMessageHash: chatMessageTextHash(request.user_message), status: "processing", protocolVersion: 2 },
        include: { strategyTurn: true, exchange: true } });
      if (!stored || stored.strategyTurn || stored.exchange) throw new Error("STRATEGY_CONTINUATION_REQUEST_CONFLICT");
      // Execution status/horizon are immutable or terminal in PostgreSQL. A
      // later store experiment cannot make this old assignment active again.
      return true;
    });
  }

  async tryReply(input: { request: ChatMessageRequest; claim?: ChatExchangeClaim; session: CheckoutSession;
    stage: ChatStage; previousStage: ChatStage; offer: SafeAuthorizedOffer;
    hasBuyerIntent: boolean; hasPreSearchedProducts: boolean }): Promise<ChatMessageResponse | undefined> {
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
    if (value.hasBuyerIntent || (session as any).buyerIntent !== undefined || value.hasPreSearchedProducts
      || value.offer.approved || value.offer.type !== "none" || value.offer.value !== 0 || value.offer.discountCode
      || value.offer.reason === "advanced_coupon_available" || (session.cart.currentDiscount ?? 0) !== 0
      || session.cart.commercialNudge || session.paymentMethod || (session as any).paymentConfirmed
      || chatPaymentSelection(request.user_message, value.stage)
      || value.stage !== deriveChatStage(session) || !["shipping", "payment"].includes(value.stage)
      || (value.previousStage === "shipping" && value.stage === "payment")) {
      throw new ServiceUnavailableException({ code: "STRATEGY_MAIN_CHAT_CONTEXT_UNSUPPORTED" });
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
      stage, missing_fields: missingFieldsForStage(publication.session, stage) };
  }
}
