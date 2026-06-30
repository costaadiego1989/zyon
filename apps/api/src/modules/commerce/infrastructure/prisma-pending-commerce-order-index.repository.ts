import { Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { DomainEventEnvelope } from "@zyon/shared-types";
import type { PendingCommerceOrderIndexPort } from "../domain/ports/pending-commerce-order-index.port.js";
import { appendOutboxInTransaction } from "./commerce-outbox.js";

@Injectable()
export class PrismaPendingCommerceOrderIndex implements PendingCommerceOrderIndexPort {
  constructor(private readonly prisma: PrismaClient) {}

  async find(merchantId: string, sessionId: string): Promise<string | undefined> {
    const row = await this.prisma.commercePendingOrder.findUnique({
      where: {
        merchantId_sessionId: {
          merchantId: merchantId.trim(),
          sessionId: sessionId.trim()
        }
      },
      select: { commerceOrderId: true }
    });
    return row?.commerceOrderId ?? undefined;
  }

  async remember(
    merchantId: string,
    sessionId: string,
    commerceOrderId: string,
    event?: DomainEventEnvelope
  ): Promise<void> {
    const mId = merchantId.trim();
    const sId = sessionId.trim();
    const orderId = commerceOrderId.trim();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.commercePendingOrder.create({
          data: { merchantId: mId, sessionId: sId, commerceOrderId: orderId, status: "pending" }
        });
        if (event) await appendOutboxInTransaction(tx, event);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return;
      }
      throw error;
    }
  }
}
