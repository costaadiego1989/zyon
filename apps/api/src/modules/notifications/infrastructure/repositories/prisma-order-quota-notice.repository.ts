import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import {
  ORDER_QUOTA_DELIVERY_LEASE_MS, type OrderQuotaNoticeRepository,
  type QuotaDeliveryClaim, type QuotaDeliveryResult,
} from "../../domain/ports/order-quota-notice.port.js";

@Injectable()
export class PrismaOrderQuotaNoticeRepository implements OrderQuotaNoticeRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async expireSending(now: Date): Promise<number> {
    const result = await this.prisma.merchantOrderQuotaDelivery.updateMany({
      where: { status: "sending", leaseUntil: { lte: now } },
      data: { status: "unknown", leaseUntil: null, lastError: "sending_lease_expired_acceptance_unknown" },
    });
    return result.count;
  }

  async claimNext(now: Date): Promise<QuotaDeliveryClaim | null> {
    for (let contention = 0; contention < 10; contention++) {
      const eligible = {
        nextAttemptAt: { lte: now },
        OR: [
          { status: { in: ["pending", "retryable_failed"] }, leaseUntil: null },
          { status: "processing", leaseUntil: { lte: now } },
        ],
      };
      const row = await this.prisma.merchantOrderQuotaDelivery.findFirst({
        where: eligible, orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }], include: { notice: true },
      });
      if (!row) return null;
      const leaseUntil = new Date(now.getTime() + ORDER_QUOTA_DELIVERY_LEASE_MS);
      const claimed = await this.prisma.merchantOrderQuotaDelivery.updateMany({
        where: { id: row.id, attempts: row.attempts, ...eligible },
        data: { status: "processing", leaseUntil },
      });
      if (claimed.count === 1) return {
        id: row.id, channel: row.channel, attempts: row.attempts, leaseUntil, notice: row.notice,
      };
    }
    return null;
  }

  async beginSending(claim: QuotaDeliveryClaim, now: Date): Promise<boolean> {
    const result = await this.prisma.merchantOrderQuotaDelivery.updateMany({
      where: {
        id: claim.id, status: "processing", attempts: claim.attempts,
        leaseUntil: { equals: claim.leaseUntil, gt: now },
      },
      data: { status: "sending", attempts: { increment: 1 } },
    });
    return result.count === 1;
  }

  async finish(claim: QuotaDeliveryClaim, result: QuotaDeliveryResult, now: Date, nextAttemptAt?: Date): Promise<boolean> {
    const saved = await this.prisma.merchantOrderQuotaDelivery.updateMany({
      where: {
        id: claim.id, status: { in: ["processing", "sending"] }, attempts: claim.attempts,
        leaseUntil: { equals: claim.leaseUntil, gt: now },
      },
      data: {
        status: result.status, leaseUntil: null, lastError: result.reason ?? null,
        providerMessageId: result.providerMessageId ?? null,
        ...(nextAttemptAt ? { nextAttemptAt } : {}),
      },
    });
    return saved.count === 1;
  }
}
