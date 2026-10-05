import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { ReturnNoticeClaim, ReturnNoticePayload, ReturnNoticeResult, ReturnNoticeType } from "../../domain/return-notice.js";

@Injectable()
export class PrismaReturnNoticeRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}
  async expireSending(now: Date): Promise<number> {
    return (await this.prisma.returnNoticeDelivery.updateMany({
      where: { status: "sending", leaseUntil: { lte: now } },
      data: { status: "unknown", leaseUntil: null, lastError: "provider_acceptance_unknown_after_restart" },
    })).count;
  }
  async claim(now: Date): Promise<ReturnNoticeClaim | null> {
    for (let contention = 0; contention < 10; contention++) {
      const eligible = { nextAttemptAt: { lte: now }, OR: [
        { status: { in: ["pending", "retryable_failed", "waiting_template", "waiting_configuration"] }, leaseUntil: null },
        { status: "processing", leaseUntil: { lte: now } },
      ] };
      const row = await this.prisma.returnNoticeDelivery.findFirst({ where: eligible,
        orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }, { id: "asc" }] });
      if (!row) return null;
      const leaseUntil = new Date(now.getTime() + 90_000);
      const changed = await this.prisma.returnNoticeDelivery.updateMany({
        where: { id: row.id, attempts: row.attempts, ...eligible },
        data: { status: "processing", leaseUntil, attempts: { increment: 1 } },
      });
      if (changed.count === 1) return { ...row, type: row.type as ReturnNoticeType,
        payload: row.payload as unknown as ReturnNoticePayload, attempts: row.attempts + 1, leaseUntil };
    }
    return null;
  }
  async begin(claim: ReturnNoticeClaim, now: Date): Promise<boolean> {
    return (await this.prisma.returnNoticeDelivery.updateMany({
      where: { id: claim.id, status: "processing", attempts: claim.attempts, leaseUntil: { equals: claim.leaseUntil, gt: now } },
      data: { status: "sending" },
    })).count === 1;
  }
  async finish(claim: ReturnNoticeClaim, result: ReturnNoticeResult, now: Date): Promise<boolean> {
    const retryDelays = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
    const waiting = result.status === "waiting_template" || result.status === "waiting_configuration";
    return (await this.prisma.returnNoticeDelivery.updateMany({
      where: { id: claim.id, status: { in: ["processing", "sending"] }, attempts: claim.attempts,
        leaseUntil: { equals: claim.leaseUntil, gt: now } },
      data: { status: result.status, leaseUntil: null, lastError: result.reason ?? null,
        providerMessageId: "providerMessageId" in result ? result.providerMessageId ?? null : null,
        ...(waiting || result.status === "retryable_failed" ? { nextAttemptAt: new Date(now.getTime() +
          (waiting ? 5 * 60_000 : retryDelays[Math.min(claim.attempts - 1, retryDelays.length - 1)])) } : {}),
      },
    })).count === 1;
  }
}
