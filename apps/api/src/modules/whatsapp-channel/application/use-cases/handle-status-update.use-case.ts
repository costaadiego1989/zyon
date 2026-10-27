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

@Injectable()
export class HandleStatusUpdateUseCase {
  private readonly logger = new Logger(HandleStatusUpdateUseCase.name);
  constructor(@Optional() @Inject(PRISMA_CLIENT) private readonly prisma?: PrismaClient) {}

  async receiveMetaReceipt(input: { merchantId: string; configId: string; messageId: string; status: string; correlationId?: string; timestamp?: string; errorCode?: number }): Promise<void> {
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
