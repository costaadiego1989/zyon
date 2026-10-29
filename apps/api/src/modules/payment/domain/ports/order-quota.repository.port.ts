import type { Prisma } from "@prisma/client";
import type { BillingPlan } from "../payment-platform.types.js";
import type { OrderQuotaEpisode, OrderQuotaPeriod } from "../services/order-quota.types.js";

export const ORDER_QUOTA_REPOSITORY = Symbol("ORDER_QUOTA_REPOSITORY");

export type PersistOrderQuotaNotice = {
  merchantId: string;
  period: OrderQuotaPeriod;
  episode: OrderQuotaEpisode;
  milestone: string;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
};

export interface OrderQuotaRepository {
  using(executor: Prisma.TransactionClient): OrderQuotaRepository;
  recordCompletedOrder(input: {
    merchantId: string;
    externalOrderId: string;
    period: OrderQuotaPeriod;
    countedAt: Date;
  }): Promise<number>;
  ensurePeriod(merchantId: string, period: OrderQuotaPeriod): Promise<number>;
  findOpenEpisodes(merchantId: string, periodStart?: Date): Promise<OrderQuotaEpisode[]>;
  getOrCreateEpisode(input: {
    merchantId: string;
    periodStart: Date;
    plan: BillingPlan;
    limit: number;
    reachedAt: Date;
    graceExpiresAt: Date;
  }): Promise<{ episode: OrderQuotaEpisode; created: boolean }>;
  markEpisodeBlocked(episodeId: string, blockedAt: Date): Promise<void>;
  resolveEpisode(episodeId: string, resolvedAt: Date, reason: string): Promise<void>;
  persistNotice(notice: PersistOrderQuotaNotice): Promise<boolean>;
  listMerchantsWithOpenEpisodes(): Promise<string[]>;
}
