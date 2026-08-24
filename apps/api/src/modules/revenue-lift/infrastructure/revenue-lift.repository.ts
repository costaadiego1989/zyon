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

@Injectable()
export class RevenueLiftRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async aggregateByCohort(merchantId: string, from: Date, to: Date): Promise<{ holdout: CohortAggregation; treatment: CohortAggregation }> {
    const rows = await (this.prisma as any).$queryRaw`
      SELECT
        cohort,
        COUNT(DISTINCT session_id)::int AS sessions,
        COUNT(*)::int AS orders,
        COALESCE(SUM(order_value_cents), 0)::int AS total_revenue_cents,
        COALESCE(SUM(ai_cost_cents), 0)::int AS total_ai_cost_cents
      FROM attribution_tags
      WHERE merchant_id = ${merchantId}
        AND created_at >= ${from}
        AND created_at <= ${to}
      GROUP BY cohort
    `;

    const empty: CohortAggregation = { sessions: 0, orders: 0, totalRevenueCents: 0, totalAiCostCents: 0 };
    const holdout = { ...empty };
    const treatment = { ...empty };

    for (const row of rows as any[]) {
      const target = row.cohort === "holdout" ? holdout : treatment;
      target.sessions = row.sessions;
      target.orders = row.orders;
      target.totalRevenueCents = row.total_revenue_cents;
      target.totalAiCostCents = row.total_ai_cost_cents;
    }

    return { holdout, treatment };
  }

  async getFeatureBreakout(merchantId: string, from: Date, to: Date): Promise<FeatureBreakout[]> {
    const rows = await (this.prisma as any).$queryRaw`
      SELECT
        CASE
          WHEN negotiation_applied THEN 'negotiation'
          WHEN cross_sell_applied THEN 'cross_sell'
          WHEN progressive_discount_applied THEN 'progressive_discount'
          WHEN cart_recovery_applied THEN 'cart_recovery'
          WHEN intent_personalization_applied THEN 'intent_personalization'
          ELSE 'baseline'
        END AS feature,
        COUNT(*)::int AS orders,
        COALESCE(SUM(order_value_cents), 0)::int AS revenue_cents
      FROM attribution_tags
      WHERE merchant_id = ${merchantId}
        AND cohort = 'treatment'
        AND created_at >= ${from}
        AND created_at <= ${to}
      GROUP BY feature
      ORDER BY revenue_cents DESC
    `;

    return (rows as any[]).map((r) => ({
      feature: r.feature,
      orders: r.orders,
      revenueCents: r.revenue_cents,
    }));
  }

  async getDailyTrend(merchantId: string, from: Date, to: Date): Promise<DailyTrendPoint[]> {
    const rows = await (this.prisma as any).$queryRaw`
      SELECT
        DATE(created_at)::text AS date,
        COALESCE(SUM(CASE WHEN cohort = 'holdout' THEN order_value_cents ELSE 0 END), 0)::int AS holdout_revenue_cents,
        COALESCE(SUM(CASE WHEN cohort = 'treatment' THEN order_value_cents ELSE 0 END), 0)::int AS treatment_revenue_cents,
        COUNT(DISTINCT CASE WHEN cohort = 'holdout' THEN session_id END)::int AS holdout_sessions,
        COUNT(DISTINCT CASE WHEN cohort = 'treatment' THEN session_id END)::int AS treatment_sessions
      FROM attribution_tags
      WHERE merchant_id = ${merchantId}
        AND created_at >= ${from}
        AND created_at <= ${to}
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `;

    return (rows as any[]).map((r) => ({
      date: r.date,
      holdoutRevenueCents: r.holdout_revenue_cents,
      treatmentRevenueCents: r.treatment_revenue_cents,
      holdoutSessions: r.holdout_sessions,
      treatmentSessions: r.treatment_sessions,
    }));
  }
}
