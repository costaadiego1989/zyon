import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { BillingPlan } from "../../domain/payment-platform.types.js";
import {
  ORDER_QUOTA_REPOSITORY,
  type OrderQuotaRepository,
  type PersistOrderQuotaNotice,
} from "../../domain/ports/order-quota.repository.port.js";
import type { OrderQuotaEpisode, OrderQuotaPeriod } from "../../domain/services/order-quota.types.js";

type PrismaExecutor = PrismaClient | Prisma.TransactionClient;

/** Persistence adapter. No pricing, grace or blocking decision belongs here. */
@Injectable()
export class PrismaOrderQuotaRepository implements OrderQuotaRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaExecutor) {}

  using(executor: Prisma.TransactionClient): OrderQuotaRepository {
    return new PrismaOrderQuotaRepository(executor);
  }

  async recordCompletedOrder(input: {
    merchantId: string;
    externalOrderId: string;
    period: OrderQuotaPeriod;
    countedAt: Date;
  }): Promise<number> {
    // The completion caller supplies the checkout transaction. This lock keeps
    // the initial historical backfill and the first order entry linearizable.
    await this.prisma.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`order-quota:${input.merchantId}:${input.period.start.toISOString()}`}))`,
    );

    const existing = await this.prisma.merchantOrderQuotaPeriod.findUnique({
      where: { merchantId_periodStart: { merchantId: input.merchantId, periodStart: input.period.start } },
    });
    // CompleteOrder has already been persisted when this method runs. A newly
    // backfilled period therefore includes this first order in its baseline.
    const periodCreatedForThisEntry = !existing;
    const baseline = existing?.usedOrders ?? await this.ensurePeriod(input.merchantId, input.period);
    const entry = await this.prisma.merchantOrderQuotaEntry.createMany({
      data: [{
        merchantId: input.merchantId,
        externalOrderId: input.externalOrderId,
        periodStart: input.period.start,
        countedAt: input.countedAt,
      }],
      skipDuplicates: true,
    });
    if (entry.count === 0 || periodCreatedForThisEntry) return baseline;

    const updated = await this.prisma.merchantOrderQuotaPeriod.update({
      where: { merchantId_periodStart: { merchantId: input.merchantId, periodStart: input.period.start } },
      data: { usedOrders: { increment: 1 } },
      select: { usedOrders: true },
    });
    return updated.usedOrders;
  }

  async ensurePeriod(merchantId: string, period: OrderQuotaPeriod): Promise<number> {
    const existing = await this.prisma.merchantOrderQuotaPeriod.findUnique({
      where: { merchantId_periodStart: { merchantId, periodStart: period.start } },
      select: { usedOrders: true },
    });
    if (existing) return existing.usedOrders;

    const usedOrders = await this.prisma.completedOrder.count({
      where: {
        merchantId,
        status: "approved",
        completedAt: { gte: period.start, lt: period.end },
      },
    });
    try {
      await this.prisma.merchantOrderQuotaPeriod.create({
        data: { merchantId, periodStart: period.start, periodEnd: period.end, usedOrders },
      });
      return usedOrders;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.prisma.merchantOrderQuotaPeriod.findUniqueOrThrow({
        where: { merchantId_periodStart: { merchantId, periodStart: period.start } },
        select: { usedOrders: true },
      });
      return raced.usedOrders;
    }
  }

  async findOpenEpisodes(merchantId: string, periodStart?: Date): Promise<OrderQuotaEpisode[]> {
    return this.prisma.merchantOrderQuotaEpisode.findMany({
      where: { merchantId, ...(periodStart ? { periodStart } : {}), resolvedAt: null },
      orderBy: { reachedAt: "desc" },
      select: {
        id: true, merchantId: true, periodStart: true, planKey: true,
        limitAtStart: true, graceExpiresAt: true, blockedAt: true, resolvedAt: true,
      },
    }) as Promise<OrderQuotaEpisode[]>;
  }

  async getOrCreateEpisode(input: {
    merchantId: string;
    periodStart: Date;
    plan: BillingPlan;
    limit: number;
    reachedAt: Date;
    graceExpiresAt: Date;
  }): Promise<{ episode: OrderQuotaEpisode; created: boolean }> {
    try {
      const episode = await this.prisma.merchantOrderQuotaEpisode.create({
        data: {
          merchantId: input.merchantId,
          periodStart: input.periodStart,
          planKey: input.plan,
          limitAtStart: input.limit,
          reachedAt: input.reachedAt,
          graceExpiresAt: input.graceExpiresAt,
        },
        select: {
          id: true, merchantId: true, periodStart: true, planKey: true,
          limitAtStart: true, graceExpiresAt: true, blockedAt: true, resolvedAt: true,
        },
      });
      return { episode, created: true };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const episode = await this.prisma.merchantOrderQuotaEpisode.findUniqueOrThrow({
        where: {
          merchantId_periodStart_planKey_limitAtStart: {
            merchantId: input.merchantId,
            periodStart: input.periodStart,
            planKey: input.plan,
            limitAtStart: input.limit,
          },
        },
        select: {
          id: true, merchantId: true, periodStart: true, planKey: true,
          limitAtStart: true, graceExpiresAt: true, blockedAt: true, resolvedAt: true,
        },
      });
      return { episode, created: false };
    }
  }

  async markEpisodeBlocked(episodeId: string, blockedAt: Date): Promise<void> {
    await this.prisma.merchantOrderQuotaEpisode.update({
      where: { id: episodeId },
      data: { blockedAt },
    });
  }

  async resolveEpisode(episodeId: string, resolvedAt: Date, reason: string): Promise<void> {
    await this.prisma.merchantOrderQuotaEpisode.update({
      where: { id: episodeId },
      data: { resolvedAt, resolutionReason: reason },
    });
  }

  async persistNotice(notice: PersistOrderQuotaNotice): Promise<boolean> {
    const persist = async (prisma: PrismaExecutor): Promise<boolean> => {
      try {
        await prisma.merchantOrderQuotaNotice.create({
          data: {
            merchantId: notice.merchantId,
            periodStart: notice.period.start,
            episodeKey: notice.episode.id,
            milestone: notice.milestone,
            title: notice.title,
            body: notice.body,
            metadata: notice.metadata as Prisma.InputJsonValue,
            deliveries: {
              create: [{ channel: "email" }, { channel: "whatsapp" }],
            },
          },
        });
        await prisma.merchantNotification.create({
          data: {
            merchantId: notice.merchantId,
            type: `order_quota_${notice.milestone}`,
            title: notice.title,
            body: notice.body,
            metadata: notice.metadata as Prisma.InputJsonValue,
          },
        });
        return true;
      } catch (error) {
        if (isUniqueViolation(error)) return false;
        throw error;
      }
    };

    if ("$transaction" in this.prisma) {
      return (this.prisma as PrismaClient).$transaction((transaction) => persist(transaction));
    }
    return persist(this.prisma);
  }

  async listMerchantsWithOpenEpisodes(): Promise<string[]> {
    const rows = await this.prisma.merchantOrderQuotaEpisode.findMany({
      where: { resolvedAt: null },
      select: { merchantId: true },
      distinct: ["merchantId"],
    });
    return rows.map((row) => row.merchantId);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "P2002");
}

export const ORDER_QUOTA_REPOSITORY_PROVIDER = {
  provide: ORDER_QUOTA_REPOSITORY,
  useExisting: PrismaOrderQuotaRepository,
};
