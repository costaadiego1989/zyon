import { ConflictException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { CheckoutChatRequest, PrismaClient } from "@prisma/client";
import type { ChatMessageReference, ChatMessageRecoveryResponse, ChatMessageRequest, ChatMessageResponse } from "@zyon/shared-types";
import { randomUUID } from "node:crypto";
import { digest } from "../../../experiments/domain/services/measurement-plan.js";
import { chatMessageIdentity, chatMessageReference, chatMessageTextHash, chatRequestsEnabled } from "../../domain/services/chat-message-identity.js";
import type { ChatExchangeClaim } from "../../domain/ports/checkout-session.repository.port.js";

/** Durable, at-most-once entry to the REAL checkout workflow. No claim takeover,
 * cached offer replay, strategy exposure assertion or transaction around I/O. */
export class CheckoutChatRequestService {
  constructor(private readonly prisma: PrismaClient) {}

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
      const result: ChatMessageResponse = { ...response, chat_request: { message_id: row.messageId, status: "completed" } };
      const responseHash = digest(JSON.parse(JSON.stringify(result)));
      await this.finish(row, "completed", responseHash);
      return result;
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
      const enabled = process.env.CHECKOUT_CHAT_RECOVERY_ENABLED === "true"
        && (process.env.CHECKOUT_CHAT_RECOVERY_MERCHANT_IDS ?? "").split(",").map(id => id.trim())
          .filter(id => id && id !== "*").includes(ref.merchant_id);
      if (!enabled) throw new ServiceUnavailableException({ code: "CHAT_MESSAGE_RECOVERY_DISABLED" });
      if (row.protocolVersion !== 2 || row.strategyTurn?.publicationPolicy !== "main_chat_text_only_v1"
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
      const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
      const changed = await tx.checkoutChatRequest.updateMany({ where: { id: row.id, merchantId: row.merchantId,
        sessionId: row.sessionId, requestHash: row.requestHash, status: "processing" },
        data: { status, responseHash, finishedAt: clock.now } });
      if (changed.count !== 1) throw new Error("CHAT_MESSAGE_FINALIZATION_CONFLICT");
    });
  }
}
