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

  /**
   * Atomically inserts a dedup row BEFORE calling the provider.
   * Returns true if this caller claimed the slot (should proceed with provider
   * call), or false if the row already existed (concurrent/duplicate delivery
   * → skip provider call).
   *
   * The row is inserted with an empty commerceOrderId sentinel; `markProcessed`
   * updates it with the real id and appends the domain event.
   */
  async tryReserve(merchantId: string, paymentReference: string): Promise<boolean> {
    try {
      await this.prisma.commercePaidEvent.create({
        data: {
          merchantId: merchantId.trim(),
          paymentReference: paymentReference.trim(),
          commerceOrderId: ""
        }
      });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return false;
      }
      throw error;
    }
  }

  /**
   * Updates the reserved row with the resolved commerceOrderId and appends the
   * domain event to the outbox in the same transaction.
   * Also idempotent as a standalone create (P2002 is swallowed) for callers
   * that never called tryReserve.
   */
  async markProcessed(
    merchantId: string,
    paymentReference: string,
    commerceOrderId = "",
    event?: DomainEventEnvelope
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.commercePaidEvent.upsert({
          where: {
            merchantId_paymentReference: {
              merchantId: merchantId.trim(),
              paymentReference: paymentReference.trim()
            }
          },
          create: {
            merchantId: merchantId.trim(),
            paymentReference: paymentReference.trim(),
            commerceOrderId: commerceOrderId.trim()
          },
          update: {
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
