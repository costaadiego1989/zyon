import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { assessMeasurement, digest, type ArmMeasurement, type MeasurementPlan } from "../../experiments/domain/services/measurement-plan.js";
import type { StrategyIncentiveRecommendation } from "../domain/strategy-incentive-recommendation.js";

/** Uses every assigned buyer, including no purchase and revoked offers. No LLM,
 * provider call, editable counts or exclusion based on receiving a discount. */
@Injectable()
export class IncentiveMetricsService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async read(merchantId: string, strategyId: string, version: number) {
    if (!Number.isSafeInteger(version) || version < 1) throw new BadRequestException("INCENTIVE_INVALID_VERSION");
    return this.prisma.$transaction(async tx => {
      const proposal = await tx.revenueStrategyVersion.findUnique({ where: { strategyId_merchantId_version: { merchantId, strategyId, version } } });
      if (!proposal) throw new NotFoundException("INCENTIVE_VERSION_NOT_FOUND");
      const execution = await tx.strategyIncentiveExecution.findFirst({ where: { merchantId, strategyId, version } });
      const identity = { strategyId, version, proposalHash: proposal.proposalHash };
      if (!execution) return { ...identity, execution: null, measurement: null };
      const recommendation = execution.recommendation as unknown as StrategyIncentiveRecommendation;
      const planning = recommendation.planning;
      if (digest(recommendation) !== execution.recommendationHash || !planning || planning.status !== "estimated_feasible"
        || !planning.minimumBuyersPerArm) throw new Error("INCENTIVE_MEASUREMENT_PLAN_INVALID");
      const budget = await tx.strategyIncentiveBudget.findFirstOrThrow({ where: { id: execution.budgetId, merchantId } });
      const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
      const rows = await tx.$queryRaw<Array<Record<string, bigint | string>>>`
        WITH assigned AS (
          SELECT a.*, a.assigned_at + INTERVAL '168 hours' AS cutoff
          FROM strategy_incentive_assignments a WHERE a.merchant_id = ${merchantId} AND a.execution_id = ${execution.id}
        ), measured AS (
          SELECT a.*, o.orders, o.revenue, o.discounts, p.refunds, p.refunded_discount,
            r.status AS reservation_status, r.amount_cents AS reserved_amount, r.spent_cents,
            s.global_user_id AS current_buyer
          FROM assigned a
          JOIN checkout_sessions s ON s.merchant_id = a.merchant_id AND s.session_id = a.session_id
          LEFT JOIN strategy_incentive_reservations r ON r.id = a.reservation_id AND r.merchant_id = a.merchant_id
          LEFT JOIN LATERAL (
            SELECT count(*) AS orders, COALESCE(sum(round(o.order_total * 100)), 0) AS revenue,
              COALESCE(sum(proof.discount_cents), 0) AS discounts
            FROM completed_orders o
            JOIN payment_intents pi ON pi.merchant_id = o.merchant_id AND pi.session_id = o.session_id
              AND pi.provider_payment_id = o.external_order_id AND length(trim(o.external_order_id)) > 0
            JOIN LATERAL (
              SELECT pe.discount_cents FROM strategy_incentive_payment_evidence pe
              WHERE pe.merchant_id = a.merchant_id AND pe.assignment_id = a.id AND pe.payment_id = pi.id
                AND pe.status = 'approved' AND pe.amount_cents = pi.amount_cents
                AND pe.occurred_at >= a.assigned_at AND pe.occurred_at < a.cutoff AND pe.occurred_at <= ${now}
              ORDER BY pe.payment_version DESC LIMIT 1
            ) proof ON true
            WHERE o.merchant_id = a.merchant_id AND o.session_id = a.session_id AND o.status = 'approved'
              AND pi.status = 'approved' AND pi.currency = 'BRL' AND o.currency = 'BRL'
              AND pi.approved_amount_cents = pi.amount_cents AND pi.amount_cents = o.order_total * 100
              AND o.completed_at >= a.assigned_at AND o.completed_at < a.cutoff AND o.completed_at <= ${now}
          ) o ON true
          LEFT JOIN LATERAL (
            SELECT count(*) FILTER (WHERE latest.status = 'refunded') AS refunds,
              COALESCE(sum(latest.discount_cents) FILTER (WHERE latest.status = 'refunded'), 0) AS refunded_discount
            FROM (SELECT DISTINCT ON (pe.payment_id) pe.status, pe.discount_cents
              FROM strategy_incentive_payment_evidence pe WHERE pe.merchant_id = a.merchant_id AND pe.assignment_id = a.id
                AND pe.occurred_at <= ${now} ORDER BY pe.payment_id, pe.payment_version DESC) latest
          ) p ON true
        ) SELECT arm, count(*) AS assigned, count(*) FILTER (WHERE cutoff <= ${now}) AS mature,
          count(*) FILTER (WHERE cutoff <= ${now} AND orders > 0) AS converted,
          COALESCE(sum(orders) FILTER (WHERE cutoff <= ${now}), 0) AS orders,
          COALESCE(sum(revenue) FILTER (WHERE cutoff <= ${now}), 0) AS revenue,
          COALESCE(sum(discounts) FILTER (WHERE cutoff <= ${now}), 0) AS discounts,
          count(*) FILTER (WHERE reservation_status = 'reserved') AS pending_reservations,
          count(*) FILTER (WHERE reservation_status = 'spent') AS redemptions,
          count(*) FILTER (WHERE reservation_status = 'released') AS released,
          COALESCE(sum(refunds), 0) AS refunds, COALESCE(sum(refunded_discount), 0) AS refunded_discount,
          count(*) FILTER (WHERE assigned_at < ${execution.startedAt} OR assigned_at >= ${execution.endsAt}
            OR assigned_at > ${now} OR buyer_id IS DISTINCT FROM current_buyer OR arm NOT IN ('control','treatment')) AS invalid
        FROM measured GROUP BY arm`;
      const issues: string[] = [];
      const arm = (name: string): ArmMeasurement & { discountCents: number; redemptions: number; pendingReservations: number; released: number; refunds: number; refundedDiscountCents: number } => {
        const row = rows.find(r => r.arm === name);
        const n = (key: string) => { const value = Number(row?.[key] ?? 0); if (!Number.isSafeInteger(value) || value < 0) issues.push("invalid_counts"); return value; };
        if (n("invalid")) issues.push("assignment_changed");
        return { assigned: n("assigned"), mature: n("mature"), converted: n("converted"), orders: n("orders"), revenueCents: n("revenue"),
          discountCents: n("discounts"), redemptions: n("redemptions"), pendingReservations: n("pending_reservations"), released: n("released"),
          refunds: n("refunds"), refundedDiscountCents: n("refunded_discount") };
      };
      if (rows.some(row => !["control", "treatment"].includes(String(row.arm)))) issues.push("invalid_arm");
      const control = arm("control"), treatment = arm("treatment");
      const plan: MeasurementPlan = { definitionVersion: "session-conversion-fixed-horizon-v1", metric: "approved_order_conversion",
        unit: "checkout_session", currency: "BRL", controlVariantId: "control", treatmentVariantId: "treatment", variantFingerprint: execution.recommendationHash,
        durationDays: planning.durationDays, conversionWindowHours: planning.conversionWindowHours, minimumEffectBps: planning.minimumEffectBps,
        minimumSessionsPerArm: planning.minimumBuyersPerArm, confidence: planning.confidence, planningPower: planning.planningPower,
        inference: planning.inference, allocation: planning.allocation,
        trafficEstimate: { sessionsPerArm: planning.weeklyBuyersPerArm ?? 0, reachesPlannedSample: true, basis: "previous_28_days" },
        baseline: { sessions: planning.baseline.buyers, conversions: planning.baseline.conversions, windowStart: planning.baseline.windowStart, windowEnd: planning.baseline.windowEnd } };
      const result = assessMeasurement(plan, { control, treatment, issues }, { registeredAt: execution.createdAt,
        startedAt: now < execution.startedAt ? null : execution.startedAt, completedAt: budget.closedAt, asOf: now });
      return { ...identity, execution: { id: execution.id, startedAt: execution.startedAt, endsAt: execution.endsAt, stoppedAt: budget.closedAt },
        measurement: { definition: "incentive-assigned-buyer-results-v1", collectedAt: now, ...result, unit: "assigned_buyer",
          minimumBuyersPerArm: planning.minimumBuyersPerArm, control, treatment,
          budget: { limitCents: budget.limitCents, reservedCents: budget.reservedCents, spentCents: budget.spentCents,
            availableCents: Math.max(0, budget.limitCents - budget.reservedCents - budget.spentCents) },
          economics: "confirmed_discount_only_not_profit", promotionAllowed: false } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  /** Existing hourly monitor calls this. A terminal notification is deduplicated
   * by execution; merely opening the dashboard creates no notifications. */
  async monitor(now: Date) {
    const executions = await this.prisma.$queryRaw<Array<{ id: string; merchantId: string; strategyId: string; version: number }>>`
      SELECT e.id, e.merchant_id AS "merchantId", e.strategy_id AS "strategyId", e.version
      FROM strategy_incentive_executions e
      LEFT JOIN merchant_notifications n ON n.id = 'incentive-result:' || e.id AND n.merchant_id = e.merchant_id
      WHERE e.ends_at + INTERVAL '168 hours' <= ${now} AND n.id IS NULL ORDER BY e.ends_at, e.id LIMIT 50`;
    for (const execution of executions) {
      const result = await this.read(execution.merchantId, execution.strategyId, execution.version);
      if (!result.measurement || ["not_started", "collecting", "awaiting_maturity"].includes(result.measurement.state)) continue;
      await this.prisma.merchantNotification.createMany({ skipDuplicates: true, data: [{ id: `incentive-result:${execution.id}`,
        merchantId: execution.merchantId, type: "ai_strategy_suggestion", title: "Os resultados do teste de desconto estão disponíveis",
        body: "Confira a conversão, os descontos confirmados e os limites da medição antes de decidir o próximo passo.",
        metadata: { strategyId: execution.strategyId, hypothesisId: execution.strategyId, version: execution.version,
          executionId: execution.id, state: result.measurement.state }, read: false }] });
    }
  }
}
