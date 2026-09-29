import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { CheckoutChatRequest, PrismaClient } from "@prisma/client";
import type { ChatDisplayReport, ChatMessageReference, ChatMessageRecoveryResponse, ChatMessageRequest, ChatMessageResponse, ChatSessionStateResponse } from "@zyon/shared-types";
import { randomUUID } from "node:crypto";
import { digest } from "../../../experiments/domain/services/measurement-plan.js";
import { chatMessageIdentity, chatMessageReference, chatMessageTextHash, chatRequestsEnabled } from "../../domain/services/chat-message-identity.js";
import type { ChatExchangeClaim } from "../../domain/ports/checkout-session.repository.port.js";
import { chatPaymentRecoveryEnabled } from "../../domain/services/chat-payment-recovery.js";
import { normalizeBuyerFacing } from "../../../payment/infrastructure/prisma-payment.repository.js";
import { checkoutNavigationBlocks, checkoutNavigationTools, MAIN_CHAT_PUBLICATION_POLICY } from "../../domain/services/checkout-chat-navigation.js";
import { toCheckoutSession } from "./checkout-session.mapper.js";
import { deriveChatStage } from "../../domain/services/customer-extraction.service.js";

/** Durable, at-most-once entry to the REAL checkout workflow. No claim takeover,
 * cached offer replay, strategy exposure assertion or transaction around I/O. */
export class CheckoutChatRequestService {
  constructor(private readonly prisma: PrismaClient) {}

  async readState(merchantId: string, sessionId: string, messageId?: string): Promise<ChatSessionStateResponse> {
    for (const value of [merchantId, sessionId]) {
      if (typeof value !== "string" || !value.trim() || value.length > 200) throw new BadRequestException("CHAT_MESSAGE_INVALID_INPUT");
    }
    if (messageId !== undefined && (typeof messageId !== "string" || !/^[a-zA-Z0-9_-]{16,128}$/.test(messageId))) {
      throw new BadRequestException("CHAT_MESSAGE_ID_REQUIRED");
    }
    // All reads share a snapshot; observing history and a receipt from different
    // commits must not release a client whose publication is still unresolved.
    return this.prisma.$transaction(async tx => {
      const scope = { merchantId, sessionId };
      const session = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: scope } });
      if (!session) throw new NotFoundException({ code: "CHECKOUT_SESSION_NOT_FOUND" });
      const active = await tx.checkoutChatRequest.findFirst({ where: { ...scope, status: { in: ["processing", "unknown"] } } });
      const request = messageId ? await tx.checkoutChatRequest.findUnique({ where: { merchantId_sessionId_messageId: { ...scope, messageId } } })
        : active ?? await tx.checkoutChatRequest.findFirst({ where: scope, orderBy: [{ startedAt: "desc" }, { id: "desc" }] });
      const owned = !!active || !!request || !!await tx.checkoutChatRequest.findFirst({ where: scope, select: { id: true } })
        || !!await tx.strategyAssignment.findUnique({ where: { merchantId_sessionId: scope }, select: { id: true } });
      const history = Array.isArray(session.chatHistory) ? session.chatHistory.slice(-50) : [];
      const requestIds = history.flatMap(item => item && typeof item === "object" && !Array.isArray(item)
        && typeof item.chatRequestId === "string" ? [item.chatRequestId] : []);
      const publications = await tx.strategyTurnPublication.findMany({ where: { merchantId, sessionId,
        requestId: { in: requestIds }, decision: "persisted", request: { status: { in: ["completed", "reconciled"] } } },
        include: { completion: { include: { turn: true } } } });
      const turns: ChatSessionStateResponse["turns"] = [];
      for (const [index, item] of history.entries()) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        if ((item.role !== "buyer" && item.role !== "agent") || typeof item.text !== "string" || typeof item.occurredAt !== "string") continue;
        const publication = item.role === "agent" ? publications.find(p => p.requestId === item.chatRequestId
          && p.agentTextHash === chatMessageTextHash(item.text as string)) : undefined;
        // Recover only the last unchanged context. Earlier controls must not
        // invite selecting stale shipping, address or payment options.
        const turn = publication?.completion.turn;
        const names = publication && Array.isArray(publication.navigationTools)
          ? checkoutNavigationTools(publication.navigationTools.map(name => ({ function: { name: String(name), arguments: {} } }))) : undefined;
        const blocks = !active && index === history.length - 1 && turn?.publicationPolicy === MAIN_CHAT_PUBLICATION_POLICY
          && turn.sessionContextVersion !== null && session.strategyContextVersion === turn.sessionContextVersion + 1 && names
          ? checkoutNavigationBlocks(names, toCheckoutSession(session)) : [];
        turns.push({ id: typeof item.chatRequestId === "string" ? `${item.chatRequestId}:${item.role}` : `${index}:${item.occurredAt}`,
          role: item.role, text: item.text, occurred_at: item.occurredAt,
          ...(blocks.length ? { blocks, checkout_stage: deriveChatStage(toCheckoutSession(session)) } : {}),
          ...(publication ? { display_ref: { turn_id: publication.turnId, text_hash: publication.agentTextHash! } } : {}) });
      }
      const payment = !active ? await this.paymentReference(tx, merchantId, sessionId) : undefined;
      return { protocol: owned || chatRequestsEnabled(merchantId) ? "durable_v2" : "legacy", session_id: sessionId,
        conversation_id: session.conversationId, turns,
        ...(payment ? { payment_intent_id: payment } : {}),
        ...(request ? { request: { message_id: request.messageId, status: request.status as NonNullable<ChatSessionStateResponse["request"]>["status"] } } : {}),
        ...(active ? { active_request: { message_id: active.messageId, status: active.status as "processing" | "unknown" } } : {}) };
    }, { isolationLevel: "RepeatableRead" });
  }

  /** Deduplicated client telemetry. Does not send/replay messages, change
   * assignment, authorize an offer or assert that a person read the text. */
  async recordDisplay(merchantId: string, report: ChatDisplayReport) {
    const input = structuredClone(report);
    if ([merchantId, input?.session_id, input?.conversation_id, input?.display_ref?.turn_id]
      .some(value => typeof value !== "string" || !value.trim() || value.length > 200)
      || input.definition !== "widget-visible-text-v1" || !/^[a-f0-9]{64}$/.test(input.display_ref?.text_hash ?? "")) {
      throw new BadRequestException("CHAT_DISPLAY_INVALID_REPORT");
    }
    return this.prisma.$transaction(async tx => {
      const scope = { merchantId, sessionId: input.session_id };
      await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id = ${merchantId} AND session_id = ${input.session_id} FOR SHARE`;
      const session = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: scope } });
      const publication = await tx.strategyTurnPublication.findFirst({ where: { ...scope, turnId: input.display_ref.turn_id,
        decision: "persisted", agentTextHash: input.display_ref.text_hash,
        request: { conversationId: input.conversation_id, status: { in: ["completed", "reconciled"] } } } });
      if (!publication || session?.conversationId !== input.conversation_id) throw new NotFoundException("CHAT_DISPLAY_NOT_AVAILABLE");
      const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
      await tx.strategyMessageDisplay.createMany({ data: [{ ...scope, turnId: publication.turnId,
        conversationId: input.conversation_id, agentTextHash: input.display_ref.text_hash,
        definition: input.definition, recordedAt: clock.now }], skipDuplicates: true });
      const row = await tx.strategyMessageDisplay.findUniqueOrThrow({ where: { turnId: publication.turnId, merchantId } });
      return { status: "recorded" as const, recorded_at: row.recordedAt.toISOString() };
    });
  }

  /** Financial credentials require the same transport scope as payment creation.
   * No provider calls, financial mutations or new idempotency keys are possible. */
  async readPayment(merchantId: string, sessionId: string, intentId: string) {
    if ([merchantId, sessionId, intentId].some(value => typeof value !== "string" || !value.trim() || value.length > 200)) {
      throw new BadRequestException("CHAT_MESSAGE_INVALID_INPUT");
    }
    return this.prisma.$transaction(async tx => {
      if (await tx.checkoutChatRequest.findFirst({ where: { merchantId, sessionId, status: { in: ["processing", "unknown"] } } })
        || await this.paymentReference(tx, merchantId, sessionId) !== intentId) {
        throw new NotFoundException({ code: "CHAT_PAYMENT_NOT_AVAILABLE" });
      }
      const payment = await tx.paymentIntent.findFirstOrThrow({ where: { id: intentId, merchantId, sessionId } });
      return { id: payment.id, method: payment.method, status: payment.status, amountCents: payment.amountCents,
        currency: payment.currency, buyerFacing: normalizeBuyerFacing(payment.buyerFacing) };
    }, { isolationLevel: "RepeatableRead" });
  }

  private async paymentReference(tx: import("@prisma/client").Prisma.TransactionClient, merchantId: string, sessionId: string) {
    // Use the most recent bound selection. A newer financial attempt, including
    // one made after flag rollback, must prevent resurfacing an older charge.
    const exchange = await tx.checkoutChatExchange.findFirst({ where: { merchantId, sessionId, paymentMethod: { not: null } },
      orderBy: [{ recordedAt: "desc" }, { requestId: "desc" }], include: { request: true } });
    if (!exchange || !["completed", "reconciled"].includes(exchange.request.status)) return undefined;
    const [payment] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT p.id FROM checkout_chat_recoverable_payment(${exchange.requestId}) p
      WHERE NOT EXISTS (SELECT 1 FROM payment_intents newer
        WHERE newer.merchant_id = ${merchantId} AND newer.session_id = ${sessionId}
          AND newer.id <> p.id AND newer.created_at >= p.created_at)`;
    return payment?.id;
  }

  async run(input: ChatMessageRequest, preflight: (request: ChatMessageRequest) => Promise<void>,
    work: (request: ChatMessageRequest, claim?: ChatExchangeClaim) => Promise<ChatMessageResponse>): Promise<ChatMessageResponse> {
    // Capture caller-owned primitives before the first await.
    const snapshot = Object.freeze({ ...input });
    const claim = await this.claim(snapshot);
    if (claim.status === "legacy") {
      await preflight(snapshot);
      return work(snapshot);
    }
    const { row, request } = claim;
    // Only quota/rate checks belong here. No customer, OTP, provider or cart work.
    try { await preflight(request); }
    catch (error) {
      await this.finish(row, "rejected", null);
      throw error;
    }
    try {
      const response = await work(request, Object.freeze({ requestId: row.id, requestHash: row.requestHash }));
      const { display_ref: _untrustedDisplayRef, ...content } = response;
      const result: ChatMessageResponse = { ...content, chat_request: { message_id: row.messageId, status: "completed" } };
      const responseHash = digest(JSON.parse(JSON.stringify(result)));
      await this.finish(row, "completed", responseHash);
      // Telemetry metadata cannot turn a successfully committed reply into an
      // unknown financial/chat result. A later state read can recover the ref.
      const publication = await this.prisma.strategyTurnPublication.findFirst({ where: { requestId: row.id,
        merchantId: row.merchantId, sessionId: row.sessionId, decision: "persisted",
        agentTextHash: chatMessageTextHash(result.message) } }).catch(() => null);
      return { ...result, ...(publication?.agentTextHash ? { display_ref: {
        turn_id: publication.turnId, text_hash: publication.agentTextHash } } : {}) };
    } catch {
      // Effects may already exist, including an accepted external operation. An
      // exception is never proof that retrying the workflow is safe. If even this
      // write fails, the original processing claim continues blocking new work.
      try { await this.finish(row, "unknown", null); } catch { /* durable claim remains */ }
      // Recovery or a lost completion acknowledgement may have fenced this
      // worker already. Report the durable terminal receipt, never stale text.
      const current = await this.prisma.checkoutChatRequest.findFirst({ where: { id: row.id,
        merchantId: row.merchantId, sessionId: row.sessionId } }).catch(() => null);
      if (current && ["completed", "reconciled"].includes(current.status)) throw this.receiptConflict(current);
      throw new ServiceUnavailableException({ code: "CHAT_MESSAGE_RECONCILIATION_REQUIRED",
        chat_request: { message_id: row.messageId, status: "unknown", next_action: "refresh_session" } });
    }
  }

  async reconcile(input: ChatMessageReference): Promise<ChatMessageRecoveryResponse> {
    // Recovery consumes only a bounded reference, never buyer text or selectors.
    const ref = chatMessageReference(input);
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id = ${ref.merchant_id}
        AND session_id = ${ref.session_id} FOR UPDATE`;
      const scope = { merchantId: ref.merchant_id, sessionId: ref.session_id };
      const session = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: scope }, select: { conversationId: true } });
      if (!session) throw new NotFoundException({ code: "CHECKOUT_SESSION_NOT_FOUND" });
      if (session.conversationId !== ref.conversation_id) throw new ConflictException({ code: "CHAT_CONVERSATION_MISMATCH" });
      await tx.$queryRaw`SELECT id FROM checkout_chat_requests WHERE merchant_id = ${ref.merchant_id}
        AND session_id = ${ref.session_id} AND message_id = ${ref.message_id} FOR UPDATE`;
      const row = await tx.checkoutChatRequest.findUnique({ where: { merchantId_sessionId_messageId: {
        ...scope, messageId: ref.message_id } }, include: { strategyTurn: true, strategyPublication: true, exchange: true } });
      if (!row) throw new NotFoundException({ code: "CHAT_MESSAGE_NOT_FOUND" });
      if (row.conversationId !== ref.conversation_id) throw new ConflictException({ code: "CHAT_CONVERSATION_MISMATCH" });
      if (row.status === "completed" || row.status === "reconciled" || row.status === "rejected") {
        return { chat_request: { message_id: row.messageId, status: row.status, next_action: "refresh_session" } };
      }
      if (row.exchange?.paymentMethod) {
        if (!chatPaymentRecoveryEnabled(ref.merchant_id)) throw new ServiceUnavailableException({ code: "CHAT_MESSAGE_RECOVERY_DISABLED" });
        // Lock the financial row before reading its evidence/version. Never run
        // provider recovery here: the financial reconciliation worker owns it.
        await tx.$queryRaw`SELECT id FROM payment_intents WHERE merchant_id = ${ref.merchant_id}
          AND session_id = ${ref.session_id} AND idempotency_key = ${`chat:${row.id}`} FOR SHARE`;
        const [payment] = await tx.$queryRaw<Array<{ id: string; version: number; status: string }>>`
          SELECT id, version, status FROM checkout_chat_recoverable_payment(${row.id})`;
        if (!payment) throw this.receiptConflict(row);
        const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
        await tx.checkoutChatPaymentResolution.create({ data: { requestId: row.id, ...scope,
          paymentIntentId: payment.id, paymentVersion: payment.version, paymentStatus: payment.status,
          previousStatus: row.status, previousFinishedAt: row.finishedAt, resolvedAt: clock.now } });
        await tx.checkoutChatRequest.update({ where: { id: row.id, merchantId: row.merchantId },
          data: { status: "reconciled", finishedAt: clock.now, responseHash: null } });
        return { chat_request: { message_id: row.messageId, status: "reconciled", next_action: "refresh_session" } };
      }
      const enabled = process.env.CHECKOUT_CHAT_RECOVERY_ENABLED === "true"
        && (process.env.CHECKOUT_CHAT_RECOVERY_MERCHANT_IDS ?? "").split(",").map(id => id.trim())
          .filter(id => id && id !== "*").includes(ref.merchant_id);
      if (!enabled) throw new ServiceUnavailableException({ code: "CHAT_MESSAGE_RECOVERY_DISABLED" });
      if (row.protocolVersion !== 2 || !["main_chat_text_only_v1", MAIN_CHAT_PUBLICATION_POLICY].includes(row.strategyTurn?.publicationPolicy ?? "")
        || row.strategyPublication?.decision !== "persisted" || !row.exchange
        || row.strategyPublication.exchangeRequestId !== row.id) throw this.receiptConflict(row);
      const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
      await tx.checkoutChatResolution.create({ data: { requestId: row.id, ...scope,
        turnId: row.strategyPublication.turnId, previousStatus: row.status,
        previousFinishedAt: row.finishedAt, resolvedAt: clock.now } });
      await tx.checkoutChatRequest.update({ where: { id: row.id, merchantId: row.merchantId },
        data: { status: "reconciled", finishedAt: clock.now, responseHash: null } });
      return { chat_request: { message_id: row.messageId, status: "reconciled", next_action: "refresh_session" } };
    });
  }

  private async claim(input: ChatMessageRequest) {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id = ${input.merchant_id}
        AND session_id = ${input.session_id} FOR UPDATE`;
      const session = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: {
        merchantId: input.merchant_id, sessionId: input.session_id } }, select: { conversationId: true } });
      if (!session) throw new NotFoundException({ code: "CHECKOUT_SESSION_NOT_FOUND" });
      const scope = { merchantId: input.merchant_id, sessionId: input.session_id };
      // Sticky ownership survives config rollback and missing/new message IDs.
      const owned = await tx.checkoutChatRequest.findFirst({ where: scope, select: { id: true } });
      if (!owned && !chatRequestsEnabled(input.merchant_id)) {
        // An assigned strategy must never enter the legacy workflow without a
        // durable key, even before its first message or after flags are disabled.
        const assignment = await tx.strategyAssignment.findUnique({ where: { merchantId_sessionId: scope }, select: { id: true } });
        if (!assignment) return { status: "legacy" as const };
      }
      const { request, requestHash } = chatMessageIdentity(input);
      const existing = await tx.checkoutChatRequest.findUnique({ where: { merchantId_sessionId_messageId: {
        ...scope, messageId: request.message_id } } });
      if (existing) {
        if (existing.requestHash !== requestHash) throw new ConflictException({ code: "CHAT_MESSAGE_KEY_CONFLICT" });
        throw this.receiptConflict(existing);
      }
      if (session.conversationId !== request.conversation_id) throw new ConflictException({ code: "CHAT_CONVERSATION_MISMATCH" });
      const active = await tx.checkoutChatRequest.findFirst({ where: { ...scope, status: { in: ["processing", "unknown"] } } });
      if (active) throw this.receiptConflict(active);
      const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
      const row = await tx.checkoutChatRequest.create({ data: { id: randomUUID(), ...scope, messageId: request.message_id,
        conversationId: request.conversation_id, requestHash, status: "processing", protocolVersion: 2,
        buyerMessageHash: chatMessageTextHash(request.user_message), startedAt: clock.now } });
      return { status: "claimed" as const, row, request };
    });
  }

  private receiptConflict(row: CheckoutChatRequest) {
    const codes: Record<string, string> = { processing: "CHAT_MESSAGE_IN_PROGRESS", unknown: "CHAT_MESSAGE_RECONCILIATION_REQUIRED",
      completed: "CHAT_MESSAGE_ALREADY_COMPLETED", rejected: "CHAT_MESSAGE_REJECTED", reconciled: "CHAT_MESSAGE_RECONCILED" };
    return new ConflictException({ code: codes[row.status], chat_request: {
      message_id: row.messageId, status: row.status, next_action: "refresh_session",
    } });
  }

  private async finish(row: CheckoutChatRequest, status: "completed" | "unknown" | "rejected", responseHash: string | null) {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id = ${row.merchantId}
        AND session_id = ${row.sessionId} FOR UPDATE`;
      const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
      const changed = await tx.checkoutChatRequest.updateMany({ where: { id: row.id, merchantId: row.merchantId,
        sessionId: row.sessionId, requestHash: row.requestHash, status: "processing" },
        data: { status, responseHash, finishedAt: clock.now } });
      if (changed.count !== 1) throw new Error("CHAT_MESSAGE_FINALIZATION_CONFLICT");
    });
  }
}
