import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { QuotaDeliveryResult } from "../../domain/ports/order-quota-notice.port.js";
import type { MerchantBudgetNotification } from "../templates/budget-request-notification.template.js";

export interface BudgetRequestDeliveryClaim {
  id: string;
  channel: string;
  attempts: number;
  leaseUntil: Date;
  request: MerchantBudgetNotification & { merchantId: string };
}

@Injectable()
export class PrismaBudgetRequestNotificationRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async expireSending(now: Date): Promise<number> {
    const result = await this.prisma.budgetRequestNotificationDelivery.updateMany({
      where: { status: "sending", leaseUntil: { lte: now } },
      data: { status: "unknown", leaseUntil: null, lastError: "provider_acceptance_unknown_after_restart" },
    });
    return result.count;
  }

  async claim(now: Date): Promise<BudgetRequestDeliveryClaim | null> {
    for (let contention = 0; contention < 10; contention++) {
      const eligible = {
        nextAttemptAt: { lte: now },
        OR: [
          { status: { in: ["pending", "retryable_failed"] }, leaseUntil: null },
          { status: "processing", leaseUntil: { lte: now } },
        ],
      };
      const delivery = await this.prisma.budgetRequestNotificationDelivery.findFirst({
        where: eligible,
        include: { budgetRequest: true },
        orderBy: [{ nextAttemptAt: "asc" }, { channel: "asc" }, { id: "asc" }],
      });
      if (!delivery) return null;
      const leaseUntil = new Date(now.getTime() + 90_000);
      const claimed = await this.prisma.budgetRequestNotificationDelivery.updateMany({
        where: { id: delivery.id, attempts: delivery.attempts, ...eligible },
        data: { status: "processing", leaseUntil, attempts: { increment: 1 } },
      });
      if (claimed.count === 1) {
        const request = delivery.budgetRequest;
        return {
          id: delivery.id,
          channel: delivery.channel,
          attempts: delivery.attempts + 1,
          leaseUntil,
          request: {
            id: request.id,
            merchantId: request.merchantId,
            merchantName: "sua loja",
            customerName: request.customerName,
            customerEmail: request.customerEmail,
            customerPhone: request.customerPhone,
            items: request.items,
            total: request.total,
            note: request.note,
          },
        };
      }
    }
    return null;
  }

  async begin(claim: BudgetRequestDeliveryClaim, now: Date): Promise<boolean> {
    return (await this.prisma.budgetRequestNotificationDelivery.updateMany({
      where: { id: claim.id, status: "processing", attempts: claim.attempts, leaseUntil: { equals: claim.leaseUntil, gt: now } },
      data: { status: "sending" },
    })).count === 1;
  }

  async finish(claim: BudgetRequestDeliveryClaim, result: QuotaDeliveryResult, now: Date): Promise<boolean> {
    const retryDelays = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
    return (await this.prisma.budgetRequestNotificationDelivery.updateMany({
      where: {
        id: claim.id,
        status: { in: ["processing", "sending"] },
        attempts: claim.attempts,
        leaseUntil: { equals: claim.leaseUntil, gt: now },
      },
      data: {
        status: result.status,
        leaseUntil: null,
        lastError: result.reason ?? null,
        providerMessageId: result.providerMessageId ?? null,
        ...(result.status === "retryable_failed"
          ? { nextAttemptAt: new Date(now.getTime() + retryDelays[Math.min(claim.attempts - 1, retryDelays.length - 1)]) }
          : {}),
      },
    })).count === 1;
  }
}
