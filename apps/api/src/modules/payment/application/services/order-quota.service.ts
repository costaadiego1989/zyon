import { ForbiddenException, Inject, Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { BILLING_PLANS } from "../../domain/billing-plans.js";
import type { BillingPlan } from "../../domain/payment-platform.types.js";
import { BillingPlanMeteringService } from "../../domain/billing-plan-guard.js";
import {
  ORDER_QUOTA_REPOSITORY,
  type OrderQuotaRepository,
} from "../../domain/ports/order-quota.repository.port.js";
import {
  graceReminderMilestone,
  requiredPlanForOrderQuota,
} from "../../domain/services/order-quota-notice.policy.js";
import {
  ORDER_QUOTA_GRACE_MS,
  orderQuotaPeriod,
  orderQuotaState,
  type OrderQuotaState,
} from "../../domain/services/order-quota.policy.js";
import type {
  OrderQuotaEpisode,
  OrderQuotaPeriod,
  OrderQuotaSnapshot,
} from "../../domain/services/order-quota.types.js";
import { OrderQuotaNoticePublisher } from "./order-quota-notice.publisher.js";

export type { OrderQuotaSnapshot } from "../../domain/services/order-quota.types.js";

/** Coordinates plan allowance, persisted episodes and admissions. */
@Injectable()
export class OrderQuotaService {
  private readonly logger = new Logger(OrderQuotaService.name);

  constructor(
    @Inject(ORDER_QUOTA_REPOSITORY) private readonly repository: OrderQuotaRepository,
    private readonly metering: BillingPlanMeteringService,
    private readonly notices: OrderQuotaNoticePublisher,
  ) {}

  async getSnapshot(merchantId: string, now = new Date()): Promise<OrderQuotaSnapshot> {
    const id = merchantId.trim();
    if (!id) throw new Error("order_quota_merchant_id_required");
    return this.evaluate(id, await this.metering.getEffectivePlan(id, now), now, this.repository);
  }

  async assertCanAcceptNewSales(merchantId: string, now = new Date()): Promise<OrderQuotaSnapshot> {
    const snapshot = await this.getSnapshot(merchantId, now);
    if (snapshot.canAcceptOrders) return snapshot;
    throw new ForbiddenException({
      code: "merchant_sales_suspended",
      merchant_id: snapshot.merchantId,
      plan: snapshot.plan,
      orders_used: snapshot.usedOrders,
      orders_limit: snapshot.limit,
      grace_expires_at: snapshot.graceExpiresAt,
      required_plan: snapshot.requiredPlan,
      usage_period_end: snapshot.periodEnd,
    });
  }

  /** Called after persistence of a non-idempotent order, normally in its transaction. */
  async recordCompletedOrder(
    input: { merchantId: string; externalOrderId: string; completedAt?: Date },
    executor?: Prisma.TransactionClient,
  ): Promise<OrderQuotaSnapshot> {
    const merchantId = input.merchantId.trim();
    const externalOrderId = input.externalOrderId.trim();
    if (!merchantId || !externalOrderId) throw new Error("order_quota_order_scope_required");
    const now = input.completedAt ?? new Date();
    const period = orderQuotaPeriod(now);
    const repository = executor ? this.repository.using(executor) : this.repository;
    const usedOrders = await repository.recordCompletedOrder({ merchantId, externalOrderId, period, countedAt: now });
    return this.evaluate(merchantId, await this.metering.getEffectivePlan(merchantId, now), now, repository, { period, usedOrders });
  }

  async reconcile(now = new Date()): Promise<number> {
    const merchantIds = await this.repository.listMerchantsWithOpenEpisodes();
    for (const merchantId of merchantIds) {
      try {
        await this.getSnapshot(merchantId, now);
      } catch (error) {
        this.logger.error("order-quota.reconcile-failed", error instanceof Error ? error.stack : String(error));
      }
    }
    return merchantIds.length;
  }

  async reconcileMerchant(merchantId: string, now = new Date()): Promise<OrderQuotaSnapshot> {
    return this.getSnapshot(merchantId, now);
  }

  private async evaluate(
    merchantId: string,
    plan: BillingPlan,
    now: Date,
    repository: OrderQuotaRepository,
    known?: { period: OrderQuotaPeriod; usedOrders: number },
  ): Promise<OrderQuotaSnapshot> {
    const period = known?.period ?? orderQuotaPeriod(now);
    const usedOrders = known?.usedOrders ?? await repository.ensurePeriod(merchantId, period);
    const limit = BILLING_PLANS[plan].limits.ordersPerMonth;
    const allOpenEpisodes = await repository.findOpenEpisodes(merchantId);
    const openEpisodes = allOpenEpisodes.filter((episode) => episode.periodStart.getTime() === period.start.getTime());
    const priorPeriods = allOpenEpisodes.filter((episode) => episode.periodStart.getTime() !== period.start.getTime());
    if (priorPeriods.length) {
      await this.resolveEpisodes(priorPeriods, "monthly_reset", plan, usedOrders, period, now, repository);
    }

    if (limit === null) {
      await this.resolveEpisodes(openEpisodes, "unlimited_plan", plan, usedOrders, period, now, repository);
      return snapshotOf({ merchantId, plan, limit, usedOrders, period, state: "active" });
    }
    if (usedOrders < limit) {
      await this.resolveEpisodes(openEpisodes, "quota_available", plan, usedOrders, period, now, repository);
      const state: OrderQuotaState = usedOrders >= Math.ceil(limit * 0.8) ? "warning" : "active";
      return snapshotOf({ merchantId, plan, limit, usedOrders, period, state });
    }

    let episode = openEpisodes.find((item) => item.planKey === plan && item.limitAtStart === limit);
    if (!episode) {
      // A plan change that is still insufficient cannot mint another grace
      // period. Keep the original deadline and let the new required plan be
      // derived from the current limit in the returned snapshot.
      episode = openEpisodes[0];
      if (!episode) {
        const created = await repository.getOrCreateEpisode({
          merchantId, periodStart: period.start, plan, limit, reachedAt: now,
          graceExpiresAt: new Date(now.getTime() + ORDER_QUOTA_GRACE_MS),
        });
        episode = created.episode;
        if (created.created) await this.notices.publish("limit", noticeContext(episode, { merchantId, plan, limit, usedOrders, period, state: "grace" }), repository);
      }
    }

    const state = orderQuotaState({ used: usedOrders, limit, graceExpiresAt: episode.graceExpiresAt, now });
    if (state === "suspended") {
      if (!episode.blockedAt) {
        await repository.markEpisodeBlocked(episode.id, now);
        episode = { ...episode, blockedAt: now };
      }
      await this.notices.publish("suspended", noticeContext(episode, { merchantId, plan, limit, usedOrders, period, state }), repository);
    } else {
      const milestone = graceReminderMilestone(episode.graceExpiresAt, now);
      if (milestone) await this.notices.publish(milestone, noticeContext(episode, { merchantId, plan, limit, usedOrders, period, state }), repository);
    }
    return snapshotOf({ merchantId, plan, limit, usedOrders, period, state, episode });
  }

  private async resolveEpisodes(
    episodes: OrderQuotaEpisode[], reason: string, plan: BillingPlan, usedOrders: number,
    period: OrderQuotaPeriod, now: Date, repository: OrderQuotaRepository,
  ): Promise<void> {
    for (const episode of episodes) {
      await repository.resolveEpisode(episode.id, now, reason);
      await this.notices.publish("reopened", noticeContext(episode, {
        merchantId: episode.merchantId, plan, limit: episode.limitAtStart, usedOrders, period, state: "active",
      }), repository);
    }
  }
}

function noticeContext(
  episode: OrderQuotaEpisode,
  input: { merchantId: string; plan: BillingPlan; limit: number; usedOrders: number; period: OrderQuotaPeriod; state: OrderQuotaState },
) {
  return { ...input, episode };
}

function snapshotOf(input: {
  merchantId: string; plan: BillingPlan; limit: number | null; usedOrders: number;
  period: OrderQuotaPeriod; state: OrderQuotaState; episode?: OrderQuotaEpisode;
}): OrderQuotaSnapshot {
  return {
    merchantId: input.merchantId,
    plan: input.plan,
    limit: input.limit,
    usedOrders: input.usedOrders,
    periodStart: input.period.start.toISOString(),
    periodEnd: input.period.end.toISOString(),
    state: input.state,
    graceExpiresAt: input.episode?.graceExpiresAt.toISOString(),
    blockedAt: input.episode?.blockedAt?.toISOString(),
    requiredPlan: input.state === "grace" || input.state === "suspended" ? requiredPlanForOrderQuota(input.plan) : undefined,
    canAcceptOrders: input.state !== "suspended",
  };
}
