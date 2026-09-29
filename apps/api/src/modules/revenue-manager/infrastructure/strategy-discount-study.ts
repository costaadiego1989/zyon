import { Prisma, type PrismaClient } from "@prisma/client";
import type { MerchantRules } from "@zyon/shared-types";
import { digest } from "../../experiments/domain/services/measurement-plan.js";
import { AnalysisDeferred } from "../domain/weekly-analysis-policy.js";
import { assertDiscountStudy, discountStudy, type StrategyDiscountStudy } from "../domain/strategy-discount-study.js";
import { discountCohorts, incentivePlanningBaseline, loadDiscountHistory } from "./discount-cohort.reader.js";
import { merchantRulesSnapshot } from "./hypothesis-merchant-context.adapter.js";
import { readIncentivePolicy } from "./incentive-policy.reader.js";
import { assertIncentiveRecommendation, incentiveRecommendation, incentiveRecommendationMatchesFrozen, plannedIncentiveRecommendation, type StrategyIncentiveRecommendation } from "../domain/strategy-incentive-recommendation.js";

export function discountStudyEnabled(merchantId: string) {
  return process.env.REVENUE_DISCOUNT_STUDY_ENABLED === "true"
    && (process.env.REVENUE_DISCOUNT_STUDY_MERCHANT_IDS ?? "").split(",").map(s => s.trim()).includes(merchantId);
}

/** Before LLM dispatch. Retries and revisions reuse even an empty study; never
 * rerun cohorts because new sales, prices or intent classifications arrived. */
export async function prepareDiscountStudy(prisma: PrismaClient, merchantId: string,
  context: { runId: string; leaseToken: number }): Promise<StrategyDiscountStudy | undefined> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM revenue_analysis_runs WHERE id = ${context.runId} AND merchant_id = ${merchantId} FOR UPDATE`;
        const run = await tx.revenueAnalysisRun.findFirst({ where: { id: context.runId, merchantId } });
        const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
        if (!run?.asOf || !run.observationId || run.status !== "running" || run.leaseToken !== context.leaseToken
          || !run.leaseUntil || run.leaseUntil <= now) throw new AnalysisDeferred("analysis_lease_lost");
        if (!run.discountStudyJson && !discountStudyEnabled(merchantId)) return undefined;
        if (!await tx.revenueAnalysisSchedule.findUnique({ where: { merchantId } })) throw new Error("STRATEGY_WEEKLY_ENROLLMENT_REQUIRED");
        const rules = merchantRulesSnapshot(await tx.merchantRule.findUniqueOrThrow({ where: { merchantId } }));
        if (run.discountStudyJson) {
          const saved = run.discountStudyJson as unknown as StrategyDiscountStudy;
          assertDiscountStudy(saved, merchantId, run.id, run.observationId, rules);
          if (saved.asOf !== run.asOf.toISOString()) throw new Error("STRATEGY_INVALID_DISCOUNT_STUDY");
          if (run.incentiveRecommendationJson) assertIncentiveRecommendation(run.incentiveRecommendationJson as unknown as StrategyIncentiveRecommendation, saved, rules);
          return saved;
        }
        const history = await loadDiscountHistory(tx, merchantId, run.asOf, 28);
        const cohorts = discountCohorts(history);
        const study = discountStudy({ merchantId, runId: run.id, observationId: run.observationId,
          asOf: run.asOf.toISOString(), capturedAt: now.toISOString(), rules, cohorts });
        const policy = await readIncentivePolicy(tx, merchantId);
        const terms = incentiveRecommendation(study, rules, policy);
        const recommendation = plannedIncentiveRecommendation(study, rules, policy,
          incentivePlanningBaseline(history, run.asOf, terms, rules));
        const changed = await tx.$executeRaw`UPDATE revenue_analysis_runs SET discount_study_json = ${JSON.stringify(study)}::jsonb,
          incentive_recommendation_json = ${JSON.stringify(recommendation)}::jsonb
          WHERE id = ${run.id} AND merchant_id = ${merchantId} AND status = 'running'
            AND lease_token = ${context.leaseToken} AND lease_until > clock_timestamp()`;
        if (changed !== 1) throw new AnalysisDeferred("analysis_lease_lost");
        return study;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 });
    } catch (error) {
      // A concurrent first capture under repeatable read retries from a fresh
      // snapshot, then reads the winner's immutable artifact.
      const conflict = error instanceof Prisma.PrismaClientKnownRequestError
        && (error.code === "P2034" || (error.code === "P2010" && error.meta?.code === "40001"));
      if (attempt >= 2 || !conflict) throw error;
    }
  }
}

export async function assertStoredDiscountStudy(tx: Prisma.TransactionClient, merchantId: string, runId: string,
  observationId: string, rules: MerchantRules, study?: StrategyDiscountStudy, recommendation?: StrategyIncentiveRecommendation) {
  const run = await tx.revenueAnalysisRun.findFirstOrThrow({ where: { id: runId, merchantId } });
  if (!study && !run.discountStudyJson) {
    if (recommendation || run.incentiveRecommendationJson) throw new Error("STRATEGY_INCENTIVE_RECOMMENDATION_CHANGED");
    return;
  }
  if (!study || !run.discountStudyJson || digest(study) !== digest(run.discountStudyJson)
    || study.asOf !== run.asOf?.toISOString()) throw new Error("STRATEGY_DISCOUNT_STUDY_CHANGED");
  assertDiscountStudy(study, merchantId, runId, observationId, rules);
  if (run.incentiveRecommendationJson || recommendation) {
    if (!study || !recommendation || !run.incentiveRecommendationJson
      || !incentiveRecommendationMatchesFrozen(recommendation, run.incentiveRecommendationJson as unknown as StrategyIncentiveRecommendation)) {
      throw new Error("STRATEGY_INCENTIVE_RECOMMENDATION_CHANGED");
    }
    assertIncentiveRecommendation(recommendation, study, rules);
  }
}
