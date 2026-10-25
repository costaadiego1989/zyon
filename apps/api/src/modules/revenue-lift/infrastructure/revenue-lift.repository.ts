import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";

export interface CohortAggregation {
  sessions: number;
  orders: number;
  totalRevenueCents: number;
  totalAiCostCents: number;
}

export interface FeatureBreakout {
  feature: string;
  orders: number;
  revenueCents: number;
}

export interface DailyTrendPoint {
  date: string;
  holdoutRevenueCents: number;
  treatmentRevenueCents: number;
  holdoutSessions: number;
  treatmentSessions: number;
}

interface CohortAggregationRow {
  cohort: string;
  sessions: number;
  orders: number;
  total_revenue_cents: number;
  total_ai_cost_cents: number;
}

interface FeatureBreakoutRow {
  feature: string;
  orders: number;
  revenue_cents: number;
}

interface DailyTrendRow {
  date: string;
  holdout_revenue_cents: number;
  treatment_revenue_cents: number;
  holdout_sessions: number;
  treatment_sessions: number;
}

@Injectable()
export class RevenueLiftRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async aggregateByCohort(merchantId: string, from: Date, to: Date): Promise<{ holdout: CohortAggregation; treatment: CohortAggregation }> {
    const rows = await this.prisma.$queryRaw<CohortAggregationRow[]>`
      WITH cohort_sessions AS (
        SELECT session_id, cohort, ai_cost_cents
        FROM checkout_sessions
        WHERE merchant_id = ${merchantId}
          AND created_at >= ${from}
          AND created_at <= ${to}
          AND cohort IN ('holdout', 'treatment')
      ), approved_orders AS (
        SELECT session_id,
          COUNT(DISTINCT external_order_id)::int AS orders,
          COALESCE(SUM(ROUND(order_total * 100)), 0)::int AS revenue_cents
        FROM completed_orders
        WHERE merchant_id = ${merchantId}
          AND status = 'approved'
        GROUP BY session_id
      )
      SELECT
        sessions.cohort,
        COUNT(*)::int AS sessions,
        COALESCE(SUM(orders.orders), 0)::int AS orders,
        COALESCE(SUM(orders.revenue_cents), 0)::int AS total_revenue_cents,
        COALESCE(SUM(CASE WHEN sessions.cohort = 'treatment' THEN sessions.ai_cost_cents ELSE 0 END), 0)::int AS total_ai_cost_cents
      FROM cohort_sessions sessions
      LEFT JOIN approved_orders orders ON orders.session_id = sessions.session_id
      GROUP BY sessions.cohort
    `;

    const empty: CohortAggregation = { sessions: 0, orders: 0, totalRevenueCents: 0, totalAiCostCents: 0 };
    const holdout = { ...empty };
    const treatment = { ...empty };

    for (const row of rows) {
      const target = row.cohort === "holdout" ? holdout : treatment;
      target.sessions = row.sessions;
      target.orders = row.orders;
      target.totalRevenueCents = row.total_revenue_cents;
      target.totalAiCostCents = row.total_ai_cost_cents;
    }

    return { holdout, treatment };
  }

  async getFeatureBreakout(merchantId: string, from: Date, to: Date): Promise<FeatureBreakout[]> {
    const rows = await this.prisma.$queryRaw<FeatureBreakoutRow[]>`
      SELECT
        CASE
          WHEN negotiation_applied THEN 'negotiation'
          WHEN cross_sell_applied THEN 'cross_sell'
          WHEN progressive_discount_applied THEN 'progressive_discount'
          WHEN cart_recovery_applied THEN 'cart_recovery'
          WHEN intent_personalization_applied THEN 'intent_personalization'
          ELSE 'baseline'
        END AS feature,
        COUNT(DISTINCT orders.external_order_id)::int AS orders,
        COALESCE(SUM(ROUND(orders.order_total * 100)), 0)::int AS revenue_cents
      FROM attribution_tags tags
      INNER JOIN completed_orders orders
        ON orders.merchant_id = tags.merchant_id
        AND orders.external_order_id = tags.order_id
        AND orders.status = 'approved'
      INNER JOIN checkout_sessions sessions
        ON sessions.merchant_id = tags.merchant_id
        AND sessions.session_id = tags.session_id
      WHERE tags.merchant_id = ${merchantId}
        AND tags.cohort = 'treatment'
        AND sessions.created_at >= ${from}
        AND sessions.created_at <= ${to}
      GROUP BY feature
      ORDER BY revenue_cents DESC
    `;

    return rows.map((r) => ({
      feature: r.feature,
      orders: r.orders,
      revenueCents: r.revenue_cents,
    }));
  }

  async getDailyTrend(merchantId: string, from: Date, to: Date): Promise<DailyTrendPoint[]> {
    const rows = await this.prisma.$queryRaw<DailyTrendRow[]>`
      SELECT
        DATE(sessions.created_at)::text AS date,
        COALESCE(SUM(CASE WHEN sessions.cohort = 'holdout' THEN ROUND(orders.order_total * 100) ELSE 0 END), 0)::int AS holdout_revenue_cents,
        COALESCE(SUM(CASE WHEN sessions.cohort = 'treatment' THEN ROUND(orders.order_total * 100) ELSE 0 END), 0)::int AS treatment_revenue_cents,
        COUNT(DISTINCT CASE WHEN sessions.cohort = 'holdout' THEN sessions.session_id END)::int AS holdout_sessions,
        COUNT(DISTINCT CASE WHEN sessions.cohort = 'treatment' THEN sessions.session_id END)::int AS treatment_sessions
      FROM checkout_sessions sessions
      LEFT JOIN completed_orders orders
        ON orders.merchant_id = sessions.merchant_id
        AND orders.session_id = sessions.session_id
        AND orders.status = 'approved'
      WHERE sessions.merchant_id = ${merchantId}
        AND sessions.created_at >= ${from}
        AND sessions.created_at <= ${to}
        AND sessions.cohort IN ('holdout', 'treatment')
      GROUP BY DATE(sessions.created_at)
      ORDER BY date ASC
    `;

    return rows.map((r) => ({
      date: r.date,
      holdoutRevenueCents: r.holdout_revenue_cents,
      treatmentRevenueCents: r.treatment_revenue_cents,
      holdoutSessions: r.holdout_sessions,
      treatmentSessions: r.treatment_sessions,
    }));
  }

  /**
   * Persist an attribution tag for a paid order. Idempotent per (merchantId, orderId):
   * a repeated completion for the same order is a no-op, never a duplicate row.
   */
  async saveTag(input: SaveAttributionTagInput): Promise<void> {
    await this.prisma.attributionTag.upsert({
      where: { merchantId_orderId: { merchantId: input.merchantId, orderId: input.orderId } },
      update: {},
      create: {
        merchantId: input.merchantId,
        orderId: input.orderId,
        sessionId: input.sessionId,
        globalUserId: input.globalUserId,
        cohort: input.cohort,
        negotiationApplied: input.negotiationApplied,
        crossSellApplied: input.crossSellApplied,
        progressiveDiscountApplied: input.progressiveDiscountApplied,
        cartRecoveryApplied: input.cartRecoveryApplied,
        intentPersonalizationApplied: input.intentPersonalizationApplied,
        experimentVariantId: input.experimentVariantId ?? null,
        orderValueCents: input.orderValueCents,
        discountGivenCents: input.discountGivenCents,
        shippingSubsidyCents: input.shippingSubsidyCents,
        aiCostCents: input.aiCostCents,
      },
    });
  }

  /**
   * Credit cart recovery on an already-written attribution tag. Called when the
   * cart-recovery module confirms (post-completion, within the attribution
   * window) that a paid order was pulled back by a recovery campaign. Scoped to
   * the tenant + order; a missing tag (holdout, or completion not yet tagged) is
   * a no-op rather than an error.
   */
  async markCartRecovery(merchantId: string, orderId: string): Promise<void> {
    await this.prisma.attributionTag.updateMany({
      where: { merchantId, orderId },
      data: { cartRecoveryApplied: true },
    });
  }
}

export interface SaveAttributionTagInput {
  merchantId: string;
  orderId: string;
  sessionId: string;
  globalUserId: string;
  cohort: "holdout" | "treatment";
  negotiationApplied: boolean;
  crossSellApplied: boolean;
  progressiveDiscountApplied: boolean;
  cartRecoveryApplied: boolean;
  intentPersonalizationApplied: boolean;
  experimentVariantId?: string;
  orderValueCents: number;
  discountGivenCents: number;
  shippingSubsidyCents: number;
  aiCostCents: number;
}
