import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { billingTerm, planMilestone, planNoticeContent, planNoticeId, isCurrentPlanNotice, type PlanNotice } from "../../domain/plan-notice.policy.js";
import type { QuotaDeliveryResult } from "../../domain/ports/order-quota-notice.port.js";

export interface PlanDeliveryClaim { id: string; channel: string; attempts: number; leaseUntil: Date; notice: PlanNotice; }
@Injectable()
export class PrismaPlanNoticeRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}
  async scan(now: Date) {
    let cursor: string | undefined;
    let scanned = 0;
    do {
      const rows = await this.prisma.merchantBillingSubscription.findMany({
        where: { OR: [{ currentPeriodEnd: { lte: new Date(now.getTime() + 7 * 86_400_000) } },
          { trialEndsAt: { lte: new Date(now.getTime() + 7 * 86_400_000) } }] },
        select: { merchantId: true }, orderBy: { merchantId: "asc" }, take: 100,
        ...(cursor ? { cursor: { merchantId: cursor }, skip: 1 } : {}),
      });
      if (!rows.length) break;
      for (const row of rows) {
        await this.prisma.$transaction(async tx => {
          await tx.$queryRaw`SELECT merchant_id FROM merchant_billing_subscriptions WHERE merchant_id = ${row.merchantId} FOR UPDATE`;
          const billing = await tx.merchantBillingSubscription.findUnique({ where: { merchantId: row.merchantId } });
          const term = billingTerm(billing);
          if (!term) return;
          const milestone = planMilestone(term.endsAt, now);
          if (!milestone) return;
          const id = planNoticeId(term, milestone);
          const created = await tx.merchantPlanNotice.createMany({ data: { id, ...term, milestone }, skipDuplicates: true });
          if (!created.count) return;
          await tx.merchantPlanNoticeDelivery.createMany({ data: ["email", "whatsapp"].map(channel => ({
            id: `${id}:${channel}`, noticeId: id, channel, nextAttemptAt: now,
          })) });
          const content = planNoticeContent({ ...term, milestone });
          await tx.merchantNotification.create({ data: { id, merchantId: row.merchantId, type: "plan_expiry",
            ...content, metadata: { endsAt: term.endsAt.toISOString(), milestone } } });
        });
        scanned++;
      }
      cursor = rows[rows.length - 1].merchantId;
      if (rows.length < 100) break;
    } while (true);
    return scanned;
  }
  async current(notice: PlanNotice, now: Date) {
    const billing = await this.prisma.merchantBillingSubscription.findUnique({ where: { merchantId: notice.merchantId } });
    return isCurrentPlanNotice(notice, billing, now);
  }
  async expireSending(now: Date) {
    const result = await this.prisma.merchantPlanNoticeDelivery.updateMany({
      where: { status: "sending", leaseUntil: { lte: now } },
      data: { status: "unknown", leaseUntil: null, lastError: "provider_acceptance_unknown_after_restart" },
    });
    return result.count;
  }
  async claim(now: Date): Promise<PlanDeliveryClaim | null> {
    for (let contention = 0; contention < 10; contention++) {
      const eligible = { nextAttemptAt: { lte: now }, OR: [
        { status: { in: ["pending", "retryable_failed"] }, leaseUntil: null },
        { status: "processing", leaseUntil: { lte: now } },
      ] };
      const row = await this.prisma.merchantPlanNoticeDelivery.findFirst({ where: eligible, include: { notice: true },
        orderBy: [{ nextAttemptAt: "asc" }, { channel: "asc" }, { id: "asc" }] });
      if (!row) return null;
      const leaseUntil = new Date(now.getTime() + 90_000);
      const result = await this.prisma.merchantPlanNoticeDelivery.updateMany({
        where: { id: row.id, attempts: row.attempts, ...eligible },
        data: { status: "processing", leaseUntil, attempts: { increment: 1 } },
      });
      if (result.count === 1) return { id: row.id, channel: row.channel, attempts: row.attempts + 1, leaseUntil, notice: row.notice };
    }
    return null;
  }
  async begin(claim: PlanDeliveryClaim, now: Date) {
    return (await this.prisma.merchantPlanNoticeDelivery.updateMany({
      where: { id: claim.id, status: "processing", attempts: claim.attempts, leaseUntil: { equals: claim.leaseUntil, gt: now } },
      data: { status: "sending" },
    })).count === 1;
  }
  async finish(claim: PlanDeliveryClaim, result: QuotaDeliveryResult, now: Date) {
    const delays = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
    return (await this.prisma.merchantPlanNoticeDelivery.updateMany({
      where: { id: claim.id, status: { in: ["processing", "sending"] }, attempts: claim.attempts,
        leaseUntil: { equals: claim.leaseUntil, gt: now } },
      data: { status: result.status, leaseUntil: null, lastError: result.reason ?? null,
        providerMessageId: result.providerMessageId ?? null,
        ...(result.status === "retryable_failed" ? { nextAttemptAt: new Date(now.getTime() + delays[Math.min(claim.attempts - 1, delays.length - 1)]) } : {}) },
    })).count === 1;
  }
}
