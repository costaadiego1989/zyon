import type { Prisma, PrismaClient } from "@prisma/client";
import { digest } from "../../experiments/domain/services/measurement-plan.js";
import { AnalysisDeferred } from "../domain/weekly-analysis-policy.js";
import { assertMeasurementPlanning, measurementPlanning, MeasurementBaselineUnavailable,
  type MeasurementPolicy, type StrategyMeasurementPlanning } from "../domain/strategy-measurement.js";

export const strategyMeasurementEnabled = () => process.env.REVENUE_STRATEGY_MEASUREMENT_ENABLED === "true";

export function measurementPolicy(): MeasurementPolicy {
  const read = (name: string, min: number, max: number) => {
    const raw = process.env[name];
    const value = Number(raw);
    if (!raw || !/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) {
      throw new AnalysisDeferred("measurement_not_configured");
    }
    return value;
  };
  return { durationDays: read("REVENUE_EXPERIMENT_DURATION_DAYS", 7, 28),
    conversionWindowHours: read("REVENUE_EXPERIMENT_CONVERSION_WINDOW_HOURS", 1, 168),
    minimumEffectBps: read("REVENUE_EXPERIMENT_MINIMUM_EFFECT_BPS", 10, 2000) };
}

export function assertCurrentMeasurementPolicy(planning: StrategyMeasurementPlanning) {
  if (!strategyMeasurementEnabled()) throw new AnalysisDeferred("strategy_measurement_disabled");
  if (digest(measurementPolicy()) !== digest(planning.policy)) throw new Error("STRATEGY_MEASUREMENT_POLICY_CHANGED");
}

/** Fenced once per weekly cycle, before reserving/calling the model. Historical
 * corrections and retries cannot silently change the proposed success criteria. */
export async function prepareStrategyMeasurement(prisma: PrismaClient, merchantId: string,
  context: { runId: string; leaseToken: number }): Promise<StrategyMeasurementPlanning | undefined> {
  if (!strategyMeasurementEnabled()) {
    const existing = await prisma.revenueAnalysisRun.findFirst({ where: { id: context.runId, merchantId }, select: { measurementPlanningJson: true } });
    if (existing?.measurementPlanningJson) throw new AnalysisDeferred("strategy_measurement_disabled");
    return undefined;
  }
  const policy = measurementPolicy();
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM revenue_analysis_runs WHERE id = ${context.runId} AND merchant_id = ${merchantId} FOR UPDATE`;
    const run = await tx.revenueAnalysisRun.findFirst({ where: { id: context.runId, merchantId,
      leaseToken: context.leaseToken, status: "running", leaseUntil: { gt: new Date() } } });
    if (!run?.asOf || !run.observationId) throw new AnalysisDeferred("analysis_lease_lost");
    if (!await tx.revenueAnalysisSchedule.findUnique({ where: { merchantId } })) throw new Error("STRATEGY_WEEKLY_ENROLLMENT_REQUIRED");
    if (run.measurementPlanningJson) {
      const saved = run.measurementPlanningJson as unknown as StrategyMeasurementPlanning;
      assertMeasurementPlanning(saved, merchantId, context.runId);
      if (saved.asOf !== run.asOf.toISOString()) throw new Error("STRATEGY_INVALID_MEASUREMENT_CONTEXT");
      assertCurrentMeasurementPolicy(saved);
      return saved;
    }
    const windowEnd = new Date(run.asOf.getTime() - policy.conversionWindowHours * 3_600_000);
    const windowStart = new Date(windowEnd.getTime() - 28 * 86_400_000);
    const capturedAt = new Date().toISOString();
    const [counts] = await tx.$queryRaw<Array<{ sessions: bigint; conversions: bigint }>>`
      WITH eligible AS (
        SELECT DISTINCT ON (s.global_user_id) s.session_id, s.created_at, s.merchant_id
        FROM checkout_sessions s
        WHERE s.merchant_id = ${merchantId} AND s.cohort = 'treatment'
          AND btrim(s.global_user_id) <> '' AND s.cart->>'currency' = 'BRL'
          AND s.created_at >= ${windowStart} AND s.created_at < ${windowEnd}
        ORDER BY s.global_user_id, s.created_at, s.id
      ) SELECT count(*) AS sessions, count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM completed_orders o WHERE o.merchant_id = s.merchant_id AND o.session_id = s.session_id
          AND o.status = 'approved' AND o.currency = 'BRL' AND o.completed_at >= s.created_at
          AND o.completed_at < s.created_at + (${policy.conversionWindowHours} * INTERVAL '1 hour')
      )) AS conversions FROM eligible s`;
    let planning: StrategyMeasurementPlanning;
    try {
      planning = measurementPlanning({ merchantId, runId: run.id, asOf: run.asOf.toISOString(), capturedAt, policy,
        baseline: { sessions: Number(counts.sessions), conversions: Number(counts.conversions),
          windowStart: windowStart.toISOString(), windowEnd: windowEnd.toISOString() } });
    } catch (error) {
      if (/EXPERIMENT_(INSUFFICIENT_PLANNING_BASELINE|INVALID_PLANNING_RATE|SAMPLE_NOT_FEASIBLE)/.test(String(error))) {
        throw new MeasurementBaselineUnavailable();
      }
      throw error;
    }
    await tx.revenueAnalysisRun.update({ where: { id: run.id }, data: {
      measurementPlanningJson: planning as unknown as Prisma.InputJsonValue,
    } });
    return planning;
  });
}

export async function assertStoredMeasurementPlanning(tx: Prisma.TransactionClient, merchantId: string,
  runId: string, planning: StrategyMeasurementPlanning) {
  assertMeasurementPlanning(planning, merchantId, runId);
  assertCurrentMeasurementPolicy(planning);
  const run = await tx.revenueAnalysisRun.findFirst({ where: { id: runId, merchantId }, select: { measurementPlanningJson: true } });
  if (!run?.measurementPlanningJson || digest(run.measurementPlanningJson) !== digest(planning)) {
    throw new Error("STRATEGY_MEASUREMENT_CONTEXT_CHANGED");
  }
}
