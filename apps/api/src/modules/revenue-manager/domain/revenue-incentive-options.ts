import type { MerchantRules } from "@zyon/shared-types";
import { digest } from "../../experiments/domain/services/measurement-plan.js";
import type { IncentivePlanningBaseline } from "./incentive-measurement.js";
import { incentivePolicySnapshot, type IncentivePolicyMode, type IncentivePolicySnapshot } from "./incentive-policy.js";
import { deriveProposedIncentivePolicy } from "./incentive-policy-proposal.js";
import { assertDiscountStudy, type StrategyDiscountStudy } from "./strategy-discount-study.js";
import { assertIncentiveRecommendation, incentiveRecommendationMatchesFrozen, plannedSelectedIncentiveRecommendation,
  selectedIncentiveRecommendation, type StrategyIncentiveRecommendation } from "./strategy-incentive-recommendation.js";

export type RevenueIncentiveOptions = {
  definition: "revenue-incentive-options-v1";
  merchantId: string; runId: string; studyHash: string;
  options: Array<{ id: string; recommendation: StrategyIncentiveRecommendation }>;
};

/** Only server-calculated feasible choices reach the model. A catalog and a
 * model selection are drafts; neither creates a policy, approval or budget. */
export function revenueIncentiveOptions(study: StrategyDiscountStudy, rules: MerchantRules,
  policy: { snapshot: IncentivePolicySnapshot; mode: IncentivePolicyMode },
  baselineFor: (recommendation: StrategyIncentiveRecommendation) => IncentivePlanningBaseline | undefined): RevenueIncentiveOptions {
  assertDiscountStudy(study, study.merchantId, study.runId, study.observationId, rules);
  if (study.definition !== "weekly-discount-study-v3") throw new Error("STRATEGY_PLANNER_STUDY_REQUIRED");
  const catalog: RevenueIncentiveOptions = { definition: "revenue-incentive-options-v1", merchantId: study.merchantId,
    runId: study.runId, studyHash: digest(study), options: [] };
  if (study.status !== "candidate_available" || policy.mode === "disabled") return catalog;
  for (const candidate of study.commercialCandidates ?? []) {
    const cap = candidate.maxDiscountCents;
    const maxSlots = Math.min(1_000_000, Math.floor(2147483647 / cap));
    if (!Number.isSafeInteger(cap) || cap < 1 || maxSlots < 1 || policy.snapshot.version >= 2147483647) continue;
    // This temporary ceiling only qualifies historical carts. It is never
    // saved, shown, dispatched to the model or used as spending authority.
    const provisional = policy.mode === "automatic" ? incentivePolicySnapshot(study.merchantId, policy.snapshot.version + 1,
      { enabled: true, maxDiscountCents: cap, maxRedemptions: maxSlots, limitCents: cap * maxSlots }) : policy.snapshot;
    const draft = selectedIncentiveRecommendation(study, rules, provisional, candidate.key);
    const baseline = baselineFor(draft);
    if (!baseline) continue;
    const proposed = policy.mode === "automatic" ? deriveProposedIncentivePolicy(policy.snapshot, baseline, study.asOf, cap) : null;
    if (policy.mode === "automatic" && !proposed) continue;
    const recommendation = plannedSelectedIncentiveRecommendation(study, rules, proposed?.policy ?? policy.snapshot,
      baseline, candidate.key, proposed?.policyProposal);
    if (recommendation.status !== "recommended" || recommendation.planning?.status !== "estimated_feasible") continue;
    catalog.options.push({ id: digest(recommendation), recommendation });
  }
  assertRevenueIncentiveOptions(catalog, study, rules);
  return catalog;
}

export function assertRevenueIncentiveOptions(value: RevenueIncentiveOptions, study: StrategyDiscountStudy, rules: MerchantRules) {
  const invalid = () => { throw new Error("STRATEGY_INVALID_INCENTIVE_OPTIONS"); };
  if (!value || value.definition !== "revenue-incentive-options-v1" || value.merchantId !== study.merchantId
    || value.runId !== study.runId || value.studyHash !== digest(study) || !Array.isArray(value.options) || value.options.length > 5
    || Object.keys(value).sort().join() !== ["definition", "merchantId", "options", "runId", "studyHash"].sort().join()) invalid();
  const ids = new Set<string>();
  for (const option of value.options) {
    if (!option || Object.keys(option).sort().join() !== ["id", "recommendation"].join()
      || option.id !== digest(option.recommendation) || ids.has(option.id)
      || option.recommendation.definition !== "weekly-incentive-recommendation-v4"
      || option.recommendation.status !== "recommended" || option.recommendation.planning?.status !== "estimated_feasible") invalid();
    assertIncentiveRecommendation(option.recommendation, study, rules); ids.add(option.id);
  }
}

export function incentiveRecommendationMatchesOptions(recommendation: StrategyIncentiveRecommendation, catalog: RevenueIncentiveOptions): boolean {
  return catalog.options.some(option => option.id === digest(option.recommendation)
    && incentiveRecommendationMatchesFrozen(recommendation, option.recommendation));
}
