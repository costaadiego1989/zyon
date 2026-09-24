import { ConflictException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { CheckoutChatRequest, PrismaClient } from "@prisma/client";
import type { ChatMessageRequest, ChatMessageResponse } from "@zyon/shared-types";
import { randomUUID } from "node:crypto";
import { digest } from "../../../experiments/domain/services/measurement-plan.js";
import { chatMessageIdentity, chatMessageTextHash, chatRequestsEnabled } from "../../domain/services/chat-message-identity.js";
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
      throw new ServiceUnavailableException({ code: "CHAT_MESSAGE_RECONCILIATION_REQUIRED",
        chat_request: { message_id: row.messageId, status: "unknown", next_action: "refresh_session" } });
    }
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
      if (!owned && !chatRequestsEnabled(input.merchant_id)) return { status: "legacy" as const };
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
      completed: "CHAT_MESSAGE_ALREADY_COMPLETED", rejected: "CHAT_MESSAGE_REJECTED" };
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
