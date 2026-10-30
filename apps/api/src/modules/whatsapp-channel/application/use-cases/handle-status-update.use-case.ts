/**
 * Handle WhatsApp status updates (delivery/read receipts).
 * Used for analytics — no user-facing action.
 */

import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

export interface StatusUpdateInput {
  merchantId: string;
  deviceId: string;
  messages: Array<{
    key: { remoteJid: string; id: string; fromMe: boolean };
    update: { status: number };
  }>;
}

const STATUS_LABELS: Record<number, string> = {
  0: "ERROR",
  1: "PENDING",
  2: "SERVER-ACK",
  3: "DELIVERY-ACK",
  4: "READ",
  5: "PLAYED",
};

interface MetaReceiptInput {
  merchantId: string; configId: string; messageId: string; status: string;
  correlationId?: string; timestamp?: string; errorCode?: number;
}
const ORDER_CORRELATION = /^order_notification:[a-f0-9]{64}$/;
const ORDER_NOTIFICATION_TYPES = new Set(["order_confirmation", "order_nonphysical_confirmation", "order_shipped", "order_delivered", "merchant_order_paid"]);
// An authenticated positive delivery/read is stronger than a contradictory
// failure. A late acceptance alone can never erase a delivery failure.
const ORDER_RECEIPT_RANK: Record<string, number> = { sent: 1, failed: 2, delivered: 3, read: 4 };

@Injectable()
export class HandleStatusUpdateUseCase {
  private readonly logger = new Logger(HandleStatusUpdateUseCase.name);
  constructor(@Optional() @Inject(PRISMA_CLIENT) private readonly prisma?: PrismaClient) {}

  async receiveMetaReceipt(input: MetaReceiptInput): Promise<void> {
    if (input.correlationId === undefined || ORDER_CORRELATION.test(input.correlationId)) {
      await this.receiveOrderNotificationReceipt(input);
      return;
    }
    if (!input.correlationId) return;
    const match = /^zyon:([a-z0-9-]{1,80}):(\d{1,3})$/.exec(input.correlationId);
    if (!match || !["sent", "delivered", "read", "failed"].includes(input.status)) return;
    if (!this.prisma) throw new Error("whatsapp_receipt_store_unavailable");
    await this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<Array<{ response_state: any; status: string }>>(Prisma.sql`
        SELECT "response_state", "status" FROM "whatsapp_webhook_inbox"
        WHERE "id" = ${match[1]} AND "merchant_id" = ${input.merchantId} AND "config_id" = ${input.configId}
        FOR UPDATE
      `);
      const row = rows[0]; const saved = row?.response_state;
      if (!saved?.presentation) return;
      const index = Number(match[2]);
      if (index >= saved.presentation.messages.length) return;
      const sent: Array<{ index: number; messageId: string }> = saved.sent ?? [];
      const known = sent.find(s => s.index === index);
      if (known && known.messageId !== input.messageId) return;
      const uncertain = saved.phase === "dispatching" && saved.dispatchingIndex === index;
      if (!known && !uncertain) return;
      const receipts = saved.receipts ?? {};
      const rank: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };
      if (rank[receipts[index]?.status ?? ""] > rank[input.status]) return;
      receipts[index] = { messageId: input.messageId, status: input.status, timestamp: input.timestamp,
        ...(input.status === "failed" && Number.isSafeInteger(input.errorCode) && input.errorCode! > 0 ? { errorCode: input.errorCode } : {}) };
      if (uncertain && input.status !== "failed") {
        sent.push({ index, messageId: input.messageId }); saved.phase = "prepared";
      }
      saved.sent = sent; saved.receipts = receipts;
      await tx.$executeRaw(Prisma.sql`
        UPDATE "whatsapp_webhook_inbox" SET "response_state" = ${JSON.stringify(saved)}::jsonb,
          "status" = CASE WHEN ${uncertain && input.status !== "failed"} AND "status" = 'dead' THEN 'pending' ELSE "status" END,
          "available_at" = CASE WHEN ${uncertain && input.status !== "failed"} THEN NOW() ELSE "available_at" END,
          "updated_at" = NOW()
        WHERE "id" = ${match[1]} AND "merchant_id" = ${input.merchantId} AND "config_id" = ${input.configId}
      `);
    });
  }

  /** Called only after HMAC/account routing. These ledger entries never belong
   * to a conversation inbox and must not reopen or repeat a dispatch. */
  private async receiveOrderNotificationReceipt(input: MetaReceiptInput): Promise<void> {
    if (!Object.hasOwn(ORDER_RECEIPT_RANK, input.status)
      || typeof input.messageId !== "string" || !input.messageId || input.messageId.length > 1024
      || /[\s\u0000-\u001f]/.test(input.messageId)) return;
    if (input.timestamp !== undefined && (typeof input.timestamp !== "string" || !/^[1-9]\d{0,15}$/.test(input.timestamp)
      || !Number.isSafeInteger(Number(input.timestamp)))) return;
    if (!this.prisma) throw new Error("whatsapp_receipt_store_unavailable");
    await this.prisma.$transaction(async tx => {
      const selector = input.correlationId !== undefined ? Prisma.sql`"id" = ${input.correlationId}`
        : Prisma.sql`"provider_message_id" = ${input.messageId} AND "id" LIKE 'order_notification:%'`;
      const rows = await tx.$queryRaw<Array<{ id: string; merchant_id: string; config_id: string; state: string;
        response: unknown; provider_message_id: string | null }>>(Prisma.sql`
        SELECT "id", "merchant_id", "config_id", "state", "response", "provider_message_id"
        FROM "whatsapp_deliveries"
        WHERE "merchant_id" = ${input.merchantId} AND "config_id" = ${input.configId} AND ${selector}
        LIMIT 2 FOR UPDATE
      `);
      if (rows.length !== 1) return;
      const row = rows[0]!;
      if (!ORDER_CORRELATION.test(row.id) || row.merchant_id !== input.merchantId || row.config_id !== input.configId
        || !["sending", "submission_unknown", "sent", "notification_delivery_failed"].includes(row.state)
        || (row.provider_message_id !== null && row.provider_message_id !== input.messageId)
        || (input.correlationId === undefined && row.provider_message_id !== input.messageId)) return;
      const saved = row.response;
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) return;
      const metadata = saved as Record<string, unknown>;
      if (metadata.kind !== "order_notification" || typeof metadata.orderId !== "string" || !metadata.orderId.trim()
        || typeof metadata.type !== "string" || !ORDER_NOTIFICATION_TYPES.has(metadata.type)) return;
      const channel = metadata.type === "merchant_order_paid" ? "whatsapp_session" : "whatsapp_template";
      const legacyUnknownChannel = row.state === "submission_unknown" && metadata.status === "unknown" && metadata.channel === "none";
      if (metadata.channel !== channel && !legacyUnknownChannel) return;
      const previous = metadata.receipt;
      if (previous !== undefined) {
        if (!previous || typeof previous !== "object" || Array.isArray(previous)) return;
        const receipt = previous as Record<string, unknown>;
        if (receipt.messageId !== input.messageId || typeof receipt.status !== "string"
          || !Object.hasOwn(ORDER_RECEIPT_RANK, receipt.status)
          || ORDER_RECEIPT_RANK[receipt.status]! >= ORDER_RECEIPT_RANK[input.status]!) return;
      }
      const failed = input.status === "failed";
      const response: Record<string, unknown> = { ...metadata, channel, status: failed ? "failed" : "accepted", receipt: {
        status: input.status, messageId: input.messageId,
        ...(input.timestamp !== undefined ? { timestamp: input.timestamp } : {}),
        ...(failed && Number.isSafeInteger(input.errorCode) && input.errorCode! > 0 ? { errorCode: input.errorCode } : {}),
      } };
      if (failed) response.reason = "provider_delivery_failed";
      else delete response.reason;
      // Moving out of sending fences the adapter's late ACK/unknown update.
      // The adapter reads this result instead of overwriting the early receipt.
      const updated = await tx.whatsAppDelivery.updateMany({ where: { id: row.id, merchantId: input.merchantId, configId: input.configId,
        state: row.state, providerMessageId: row.provider_message_id }, data: {
        response: response as Prisma.InputJsonValue, providerMessageId: input.messageId,
        state: failed ? "notification_delivery_failed" : "sent",
      } });
      if (updated.count !== 1) throw new Error("whatsapp_order_receipt_conflict");
    });
  }

  async execute(input: StatusUpdateInput): Promise<void> {
    for (const msg of input.messages) {
      const statusLabel = STATUS_LABELS[msg.update.status] ?? `UNKNOWN(${msg.update.status})`;
      this.logger.debug(
        `whatsapp_status_update merchant=${input.merchantId} status=${statusLabel}`,
      );

      // TODO: persist for analytics (message delivery rate, read rate, response time)
      // await this.analyticsRepo.trackMessageStatus(input.merchantId, msg.key.id, msg.update.status);
    }
  }
}
