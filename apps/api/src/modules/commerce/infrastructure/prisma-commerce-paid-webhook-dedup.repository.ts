import { Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { DomainEventEnvelope } from "@aacp/shared-types";
import type { CommercePaidWebhookDedupPort } from "../domain/ports/commerce-paid-webhook-dedup.port.js";
import { appendOutboxInTransaction } from "./commerce-outbox.js";

@Injectable()
export class PrismaCommercePaidWebhookDedup implements CommercePaidWebhookDedupPort {
  constructor(private readonly prisma: PrismaClient) {}

  async isProcessed(merchantId: string, paymentReference: string): Promise<boolean> {
    const row = await this.prisma.commercePaidEvent.findUnique({
      where: {
        merchantId_paymentReference: {
          merchantId: merchantId.trim(),
          paymentReference: paymentReference.trim()
        }
      },
      select: { merchantId: true }
    });
    return Boolean(row);
  }

  async markProcessed(
    merchantId: string,
    paymentReference: string,
    commerceOrderId = "",
    event?: DomainEventEnvelope
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.commercePaidEvent.create({
          data: {
            merchantId: merchantId.trim(),
            paymentReference: paymentReference.trim(),
            commerceOrderId: commerceOrderId.trim()
          }
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
