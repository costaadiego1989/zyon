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
    const msg = await this.prisma.postSaleScheduledMessage.create({
      data: {
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
    const messages = await this.prisma.postSaleScheduledMessage.findMany({
      where: {
        status: "pending",
        sendAt: {
          lte: new Date(),
        },
      },
      orderBy: { sendAt: "asc" },
      take: limit,
    });

    return messages.map((m) => this.mapToDomain(m));
  }

  async update(
    id: string,
    data: {
      status?: ScheduledMessage["status"];
      sentAt?: Date;
      messageContent?: string;
    }
  ): Promise<ScheduledMessage> {
    const updated = await this.prisma.postSaleScheduledMessage.update({
      where: { id },
      data: {
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
    return {
      id: raw.id,
      merchantId: raw.merchantId,
      buyerId: raw.buyerId,
      orderId: raw.orderId,
      type: raw.type,
      channel: raw.channel,
      sendAt: raw.sendAt,
      status: raw.status,
      sentAt: raw.sentAt,
      messageContent: raw.messageContent,
      buyerPhone: raw.buyerPhone,
      buyerEmail: raw.buyerEmail,
      buyerName: raw.buyerName,
      productName: raw.productName,
      metadata: raw.metadata,
      createdAt: raw.createdAt,
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
