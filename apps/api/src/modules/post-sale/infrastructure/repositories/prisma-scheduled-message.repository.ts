import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import {
  SCHEDULED_MESSAGE_REPOSITORY,
  type ScheduledMessageRepositoryPort,
  type ScheduledMessage,
  type CreateScheduledMessageInput,
} from "../../domain/ports/scheduled-message-repository.port.js";

@Injectable()
export class PrismaScheduledMessageRepository implements ScheduledMessageRepositoryPort {
  constructor(private prisma: PrismaClient) {}

  async create(input: CreateScheduledMessageInput): Promise<ScheduledMessage> {
    const identity = { merchantId: input.merchantId, buyerId: input.buyerId, orderId: input.orderId, type: input.type };
    const sku = input.type === "reorder" && typeof input.metadata?.sku === "string" ? input.metadata.sku : undefined;
    const existing = await this.prisma.postSaleScheduledMessage.findFirst({ where: { ...identity, ...(sku ? { metadata: { path: ["sku"], equals: sku } } : {}) } });
    if (existing) return this.mapToDomain(existing);
    const id = "ps_" + createHash("sha256").update(JSON.stringify({ ...identity, ...(sku ? { sku } : {}) })).digest("hex");
    const msg = await this.prisma.postSaleScheduledMessage.upsert({
      where: { id }, update: { id }, create: { id,
        merchantId: input.merchantId,
        buyerId: input.buyerId,
        orderId: input.orderId,
        type: input.type,
        channel: input.channel,
        sendAt: input.sendAt,
        status: "pending",
        buyerPhone: input.buyerPhone || null,
        buyerEmail: input.buyerEmail || null,
        buyerName: input.buyerName || null,
        productName: input.productName || null,
        metadata: input.metadata ? (input.metadata as any) : undefined,
      },
    });

    return this.mapToDomain(msg);
  }

  async findPendingDue(limit: number): Promise<ScheduledMessage[]> {
    // Atomic claim: SELECT FOR UPDATE SKIP LOCKED + status transition to 'processing'.
    // Prevents double-send when multiple API instances run concurrently.
    // Expired claims are held for reconciliation because a worker may have sent before crashing.
    await (this.prisma as any).postSaleScheduledMessage.updateMany({
      where: { status: "processing", processingAt: { lt: new Date(Date.now() - 15 * 60_000) } },
      data: { status: "unknown", failureReason: "processing_lease_expired" },
    });
    const claimed: any[] = await this.prisma.$queryRawUnsafe(
      `UPDATE post_sale_scheduled_messages
       SET status = 'processing', processing_at = NOW()
       WHERE id IN (
         SELECT id FROM post_sale_scheduled_messages
         WHERE status = 'pending' AND send_at <= NOW()
         ORDER BY send_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *`,
      limit,
    );

    return claimed.map((m) => this.mapToDomain(m));
  }

  async update(
    id: string,
    data: {
      status?: ScheduledMessage["status"];
      sentAt?: Date;
      messageContent?: string;
      channel?: "whatsapp" | "email";
      providerMessageId?: string;
      failureReason?: string;
    }
  ): Promise<ScheduledMessage> {
    const updated = await this.prisma.postSaleScheduledMessage.update({
      where: { id },
      data: {
        channel: data.channel, providerMessageId: data.providerMessageId, failureReason: data.failureReason,
        status: data.status,
        sentAt: data.sentAt,
        messageContent: data.messageContent,
      },
    });

    return this.mapToDomain(updated);
  }

  async findByOrderId(merchantId: string, orderId: string): Promise<ScheduledMessage[]> {
    const messages = await this.prisma.postSaleScheduledMessage.findMany({
      where: { merchantId, orderId },
    });

    return messages.map((m) => this.mapToDomain(m));
  }

  private mapToDomain(raw: any): ScheduledMessage {
    // Accept both Prisma camelCase (from .create/.update) and raw snake_case
    // (from $queryRawUnsafe in findPendingDue).
    return {
      id: raw.id,
      merchantId: raw.merchantId ?? raw.merchant_id,
      buyerId: raw.buyerId ?? raw.buyer_id,
      orderId: raw.orderId ?? raw.order_id,
      type: raw.type,
      channel: raw.channel,
      sendAt: raw.sendAt ?? raw.send_at,
      status: raw.status,
      sentAt: raw.sentAt ?? raw.sent_at,
      messageContent: raw.messageContent ?? raw.message_content,
      buyerPhone: raw.buyerPhone ?? raw.buyer_phone,
      buyerEmail: raw.buyerEmail ?? raw.buyer_email,
      buyerName: raw.buyerName ?? raw.buyer_name,
      productName: raw.productName ?? raw.product_name,
      metadata: raw.metadata,
      createdAt: raw.createdAt ?? raw.created_at,
    };
  }

  async countByStatus(merchantId: string, status: string): Promise<number> {
    return this.prisma.postSaleScheduledMessage.count({
      where: { merchantId, status },
    });
  }

  async countAll(merchantId: string): Promise<number> {
    return this.prisma.postSaleScheduledMessage.count({
      where: { merchantId },
    });
  }
}
