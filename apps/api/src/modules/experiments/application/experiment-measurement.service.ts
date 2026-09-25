import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { assessMeasurement, buildMeasurementPlan, digest, fingerprintVariants,
  type ArmMeasurement, type MeasurementPlan } from "../domain/services/measurement-plan.js";
import { readStrategyMeasurement, strategyDeliveryMetrics, strategyCostCoverage } from "../infrastructure/strategy-measurement.reader.js";

const DAY = 86_400_000;
type Counts = Record<string, bigint | number | string>;
const integerConfig = (name: string): number => {
  const raw = process.env[name];
  if (!raw || !/^\d+$/.test(raw)) throw new ServiceUnavailableException("EXPERIMENT_MEASUREMENT_NOT_CONFIGURED");
  return Number(raw);
};

@Injectable()
export class ExperimentMeasurementService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async read(merchantId: string, experimentId: string) {
    const experiment = await this.prisma.promptExperiment.findFirst({ where: { id: experimentId, merchantId }, select: { id: true } });
    if (!experiment) throw new NotFoundException("EXPERIMENT_NOT_FOUND");
    const plan = await this.prisma.experimentMeasurementPlan.findFirst({ where: { experimentId, merchantId } });
    const reviews = plan ? await this.prisma.experimentMeasurementReview.findMany({
      where: { experimentId, merchantId }, orderBy: [{ collectedAt: "desc" }, { id: "desc" }], take: 20,
      select: { id: true, planHash: true, evidenceHash: true, result: true, collectedAt: true },
    }) : [];
    return { plan, reviews, activationAvailable: false };
  }

  /** No client-supplied counts, actor, metric, or financial authority. The server
   * prepares a plan from a mature historical cohort and explicit operator policy.
   * This freezes measurement only; it does not approve or activate a strategy. */
  async prepare(merchantId: string, experimentId: string, now = new Date()) {
    return this.prisma.$transaction(async tx => {
      await this.lock(tx, merchantId, experimentId);
      const existing = await tx.experimentMeasurementPlan.findFirst({ where: { experimentId, merchantId } });
      if (existing) return existing;
      if (!await tx.revenueAnalysisSchedule.findUnique({ where: { merchantId }, select: { merchantId: true } })) {
        throw new ConflictException("EXPERIMENT_WEEKLY_ENROLLMENT_REQUIRED");
      }
      const experiment = await tx.promptExperiment.findFirst({ where: { id: experimentId, merchantId }, include: { variants: true } });
      if (!experiment || experiment.status !== "draft" || experiment.startedAt) throw new ConflictException("EXPERIMENT_PLAN_MUST_PRECEDE_ACTIVATION");
      const variantIds = experiment.variants.map(v => v.id);
      if (await tx.checkoutSession.count({ where: { merchantId, promptVariantId: { in: variantIds } } })
        || await tx.promptVariantResult.count({ where: { variantId: { in: variantIds } } })) {
        throw new ConflictException("EXPERIMENT_PLAN_MUST_PRECEDE_ASSIGNMENT");
      }
      const durationDays = integerConfig("REVENUE_EXPERIMENT_DURATION_DAYS");
      const conversionWindowHours = integerConfig("REVENUE_EXPERIMENT_CONVERSION_WINDOW_HOURS");
      const minimumEffectBps = integerConfig("REVENUE_EXPERIMENT_MINIMUM_EFFECT_BPS");
      if (conversionWindowHours < 1 || conversionWindowHours > 168) throw new ServiceUnavailableException("EXPERIMENT_INVALID_MEASUREMENT_CONFIG");
      const windowEnd = new Date(now.getTime() - conversionWindowHours * 3_600_000);
      const windowStart = new Date(windowEnd.getTime() - 28 * DAY);
      const [baseline] = await tx.$queryRaw<Counts[]>`
        SELECT count(*) AS sessions, count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM completed_orders o WHERE o.merchant_id = s.merchant_id AND o.session_id = s.session_id
            AND o.status = 'approved' AND o.currency = 'BRL' AND o.completed_at >= s.created_at
            AND o.completed_at < s.created_at + (${conversionWindowHours} * INTERVAL '1 hour')
        )) AS conversions
        FROM checkout_sessions s WHERE s.merchant_id = ${merchantId}
          AND s.cohort IS DISTINCT FROM 'holdout' AND s.created_at >= ${windowStart} AND s.created_at < ${windowEnd}`;
      let plan: MeasurementPlan;
      try {
        plan = buildMeasurementPlan({ variants: experiment.variants, durationDays, conversionWindowHours, minimumEffectBps,
          baseline: { sessions: Number(baseline.sessions), conversions: Number(baseline.conversions),
            windowStart: windowStart.toISOString(), windowEnd: windowEnd.toISOString() } });
      } catch (error) {
        throw new ConflictException(error instanceof Error ? error.message : "EXPERIMENT_INVALID_MEASUREMENT_PLAN");
      }
      return tx.experimentMeasurementPlan.create({ data: { experimentId, merchantId, planHash: digest(plan),
        plan: plan as unknown as Prisma.InputJsonValue, createdAt: now } });
    });
  }

  /** A repeated key returns the original evidence. A later correction uses a new
   * key and snapshot; it cannot silently rewrite a prior merchant decision. */
  async capture(merchantId: string, experimentId: string, requestKey: string, now = new Date()) {
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(requestKey)) throw new BadRequestException("EXPERIMENT_REVIEW_KEY_REQUIRED");
    return this.prisma.$transaction(async tx => {
      await this.lock(tx, merchantId, experimentId);
      const prior = await tx.experimentMeasurementReview.findFirst({ where: { experimentId, merchantId, requestKey } });
      if (prior) return prior;
      const stored = await tx.experimentMeasurementPlan.findFirst({ where: { experimentId, merchantId } });
      if (!stored) throw new ConflictException("EXPERIMENT_MEASUREMENT_PLAN_REQUIRED");
      const plan = stored.plan as unknown as MeasurementPlan;
      if (digest(plan) !== stored.planHash) throw new ConflictException("EXPERIMENT_MEASUREMENT_PLAN_CORRUPT");
      const experiment = await tx.promptExperiment.findFirst({ where: { id: experimentId, merchantId }, include: { variants: true } });
      if (!experiment) throw new NotFoundException("EXPERIMENT_NOT_FOUND");
      const issues: string[] = [];
      if (fingerprintVariants(experiment.variants) !== plan.variantFingerprint) issues.push("variant_definition_changed");
      const start = experiment.startedAt ?? now;
      const end = new Date(start.getTime() + plan.durationDays * DAY);
      const hours = plan.conversionWindowHours;
      const execution = await tx.strategyExecution.findFirst({ where: { experimentId, merchantId } });
      if (execution && (execution.startedAt.getTime() !== start.getTime() || execution.endsAt.getTime() !== end.getTime()
        || digest(execution.contract) !== execution.contractHash)) issues.push("strategy_execution_contract_changed");
      // One SQL statement observes assignments and order state in the same MVCC
      // snapshot. It starts at assignments, not result rows: non-buyers stay in.
      const rows = execution ? await readStrategyMeasurement(tx, execution, plan, now) : await tx.$queryRaw<Counts[]>`
        WITH assigned AS (
          SELECT s.*, s.created_at + (${hours} * INTERVAL '1 hour') AS cutoff,
            count(*) OVER (PARTITION BY s.global_user_id) AS buyer_sessions
          FROM checkout_sessions s WHERE s.merchant_id = ${merchantId}
            AND s.prompt_variant_id IN (${plan.controlVariantId}, ${plan.treatmentVariantId})
        ), measured AS (
          SELECT s.*, COALESCE(o.orders, 0) AS orders, COALESCE(o.cents, 0) AS cents,
            COALESCE(o.other_currency, 0) AS other_currency, COALESCE(o.bad_amount, 0) AS bad_amount
          FROM assigned s LEFT JOIN LATERAL (
            SELECT count(*) AS orders, COALESCE(sum(round(order_total * 100)) FILTER (WHERE currency = 'BRL'), 0) AS cents,
              count(*) FILTER (WHERE currency <> 'BRL') AS other_currency,
              count(*) FILTER (WHERE order_total < 0 OR order_total * 100 <> trunc(order_total * 100)) AS bad_amount
            FROM completed_orders WHERE merchant_id = ${merchantId} AND session_id = s.session_id AND status = 'approved'
              AND completed_at >= s.created_at AND completed_at < s.cutoff AND completed_at <= ${now}
          ) o ON true
        ) SELECT prompt_variant_id AS variant, count(*) AS assigned,
          count(*) FILTER (WHERE cutoff <= ${now}) AS mature,
          count(*) FILTER (WHERE cutoff <= ${now} AND orders > 0) AS converted,
          COALESCE(sum(orders) FILTER (WHERE cutoff <= ${now}), 0) AS orders,
          COALESCE(sum(cents) FILTER (WHERE cutoff <= ${now}), 0) AS cents,
          count(*) FILTER (WHERE created_at < ${start} OR created_at >= ${end} OR created_at > ${now}) AS outside_window,
          count(*) FILTER (WHERE cohort = 'holdout') AS holdout,
          count(*) FILTER (WHERE cohort IS NULL OR cohort NOT IN ('holdout', 'treatment')) AS unknown_cohort,
          count(*) FILTER (WHERE buyer_sessions > 1 OR global_user_id = '') AS repeated_buyer,
          COALESCE(sum(other_currency), 0) AS other_currency, COALESCE(sum(bad_amount), 0) AS bad_amount
        FROM measured GROUP BY prompt_variant_id ORDER BY prompt_variant_id`;
      for (const row of rows) {
        for (const [column, reason] of Object.entries({ outside_window: "assignment_outside_fixed_horizon",
          holdout: "holdout_contamination", unknown_cohort: "assignment_cohort_unknown", repeated_buyer: "session_independence_unverified",
          changed_identity: "participant_identity_changed", changed_entry: "participant_entry_changed",
          invalid_arm: "assignment_arm_invalid", changed_currency: "participant_currency_changed",
          other_currency: "mixed_order_currencies", bad_amount: "invalid_order_amount" })) {
          if (Number(row[column]) > 0) issues.push(reason);
        }
      }
      const arm = (id: string): ArmMeasurement => {
        const row = rows.find(r => r.variant === id);
        return { assigned: Number(row?.assigned ?? 0), mature: Number(row?.mature ?? 0), converted: Number(row?.converted ?? 0),
          orders: Number(row?.orders ?? 0), revenueCents: Number(row?.cents ?? 0) };
      };
      const delivery = execution ? strategyDeliveryMetrics(rows, plan) : undefined;
      const economics = execution ? strategyCostCoverage(rows, plan) : undefined;
      const evidence = { control: arm(plan.controlVariantId), treatment: arm(plan.treatmentVariantId), issues,
        ...(delivery ? { delivery, economics, executionId: execution!.id, proposalHash: execution!.proposalHash } : {}) };
      const result = { ...assessMeasurement(plan, evidence, { registeredAt: stored.createdAt,
        startedAt: experiment.startedAt, completedAt: experiment.completedAt, asOf: now }),
        ...(delivery ? { delivery, economics, executionId: execution!.id, strategyVersion: execution!.version, proposalHash: execution!.proposalHash } : {}) };
      return tx.experimentMeasurementReview.create({ data: { id: randomUUID(), experimentId, merchantId, requestKey,
        planHash: stored.planHash, evidenceHash: digest(evidence), result: result as unknown as Prisma.InputJsonValue, collectedAt: now } });
    });
  }

  private async lock(tx: Prisma.TransactionClient, merchantId: string, experimentId: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM prompt_experiments WHERE id = ${experimentId} AND merchant_id = ${merchantId} FOR UPDATE`;
    if (!rows.length) throw new NotFoundException("EXPERIMENT_NOT_FOUND");
  }
}
