import type { MerchantRules } from "@zyon/shared-types";
import { digest } from "../../experiments/domain/services/measurement-plan.js";
import { assertDiscountStudy, type StrategyDiscountStudy } from "./strategy-discount-study.js";
import { incentivePolicySnapshot, type IncentivePolicySnapshot } from "./incentive-policy.js";
import { incentiveMeasurementPlanning, type IncentiveMeasurementPlanning, type IncentivePlanningBaseline } from "./incentive-measurement.js";

/** Automatically planned terms for a SEPARATE incentive test. Neither this
 * document nor approval of its companion communication strategy permits spend. */
export type StrategyIncentiveRecommendation = {
  definition: "weekly-incentive-recommendation-v1" | "weekly-incentive-recommendation-v2" | "weekly-incentive-recommendation-v3";
  planning?: IncentiveMeasurementPlanning;
  alternative?: { definition: "incentive-conservative-alternative-v1"; sequence: number; sourceRecommendationHash: string };
  merchantId: string; runId: string; observationId: string; studyHash: string;
  financialPolicy: IncentivePolicySnapshot;
  approval: "separate_incentive_review_required";
  execution: "unavailable";
  budgetStatus: "not_reserved";
} & ({ status: "not_recommended"; reason: "no_safe_candidate" | "financial_policy_disabled"; test?: never } | {
  status: "recommended";
  test: {
    kind: "capped_percentage_discount" | "capped_fixed_discount" | "capped_shipping_discount";
    fixedDiscountCents?: number;
    shippingDiscountCents?: number;
    delivery?: { mode: "automatic" } | { mode: "coupon_code"; code: string };
    currency: "BRL";
    audience: { intent: string; consent: "required"; identity: "first_eligible_session_per_buyer";
      holdout: "excluded"; minCartTotalCents: number; maxCartTotalCents: number };
    discountPercent: number; maxDiscountCents: number; limitCents: number; maxRedemptions: number; maxPerBuyer: 1;
    durationDays: 7; start: "after_specific_approval"; allocation: "50/50";
    control: "current_checkout_without_test_incentive";
    stacking: "no_other_coupon_or_incentive";
    minimumMarginPercent: number;
    budgetBasis: "worst_case_discount_times_max_redemptions";
    measurement: { conversionWindowHours: 168; primary: "approved_order_conversion_per_assigned_buyer";
      guardrails: ["discount_spend", "configured_product_margin", "refunds"];
      result: "not_measured"; samplePlanning: "required_before_activation" | "included_in_recommendation" };
  };
});

export function incentiveRecommendation(study: StrategyDiscountStudy, rules: MerchantRules,
  policy: IncentivePolicySnapshot): StrategyIncentiveRecommendation {
  assertDiscountStudy(study, study.merchantId, study.runId, study.observationId, rules);
  const financialPolicy = incentivePolicySnapshot(policy.merchantId, policy.version, policy);
  if (financialPolicy.merchantId !== study.merchantId || digest(financialPolicy) !== digest(policy)
    || (policy.enabled && policy.version < 1)) throw new Error("STRATEGY_INVALID_INCENTIVE_POLICY");
  const base = { definition: "weekly-incentive-recommendation-v1" as const, merchantId: study.merchantId,
    runId: study.runId, observationId: study.observationId, studyHash: digest(study), financialPolicy,
    approval: "separate_incentive_review_required" as const, execution: "unavailable" as const, budgetStatus: "not_reserved" as const };
  if (study.status !== "candidate_available") return { ...base, status: "not_recommended", reason: "no_safe_candidate" };
  if (!policy.enabled) return { ...base, status: "not_recommended", reason: "financial_policy_disabled" };
  const sample = study.candidate.simulation;
  const maxDiscountCents = Math.min(sample.maxDiscountCents, policy.maxDiscountCents, policy.limitCents);
  const maxRedemptions = Math.min(policy.maxRedemptions, Math.floor(policy.limitCents / maxDiscountCents));
  // Integer cents and complete worst-case slots; historical replay totals are
  // never treated as a demand forecast or an approved commercial budget.
  const limitCents = maxDiscountCents * maxRedemptions;
  return { ...base, status: "recommended", test: {
    kind: "capped_percentage_discount", currency: "BRL",
    audience: { intent: study.candidate.intent, consent: "required", identity: "first_eligible_session_per_buyer",
      holdout: "excluded", minCartTotalCents: sample.minCartTotalCents, maxCartTotalCents: sample.maxCartTotalCents },
    discountPercent: study.candidate.percent, maxDiscountCents, limitCents, maxRedemptions, maxPerBuyer: 1,
    durationDays: 7, start: "after_specific_approval", allocation: "50/50", control: "current_checkout_without_test_incentive",
    stacking: "no_other_coupon_or_incentive", minimumMarginPercent: rules.minimumMarginPercent,
    budgetBasis: "worst_case_discount_times_max_redemptions",
    measurement: { conversionWindowHours: 168, primary: "approved_order_conversion_per_assigned_buyer",
      guardrails: ["discount_spend", "configured_product_margin", "refunds"], result: "not_measured", samplePlanning: "required_before_activation" },
  } };
}

export function assertIncentiveRecommendation(value: StrategyIncentiveRecommendation,
  study: StrategyDiscountStudy, rules: MerchantRules) {
  if (!value || !study) throw new Error("STRATEGY_INVALID_INCENTIVE_RECOMMENDATION");
  const primary = value.definition === "weekly-incentive-recommendation-v3"
    ? plannedCommercialIncentiveRecommendation(study, rules, value.financialPolicy, value.planning?.baseline)
    : value.definition === "weekly-incentive-recommendation-v2"
    ? plannedIncentiveRecommendation(study, rules, value.financialPolicy, value.planning?.baseline)
    : incentiveRecommendation(study, rules, value.financialPolicy);
  const expected = value.alternative ? conservativeIncentiveAlternative(primary, value.alternative.sequence) : primary;
  if (!expected || digest(value) !== digest(expected)) {
    throw new Error("STRATEGY_INVALID_INCENTIVE_RECOMMENDATION");
  }
}

/** A server-selected alternative from the SAME frozen study. Reducing both the
 * rate and per-buyer cap preserves the historical margin bound; audience,
 * duration and exposure stay fixed, while each new version needs new consent.
 * Feedback never supplies prices, caps or populations. No history or AI reread. */
export function conservativeIncentiveAlternative(primary: StrategyIncentiveRecommendation,
  sequence: number): StrategyIncentiveRecommendation | null {
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 3 || primary.alternative
    || !["weekly-incentive-recommendation-v2", "weekly-incentive-recommendation-v3"].includes(primary.definition)
    || primary.status !== "recommended" || !primary.planning) return null;
  const factor = sequence + 1;
  const discountBps = Math.floor(Math.round(primary.test.discountPercent * 100) / factor);
  const maxDiscountCents = Math.min(Math.floor(primary.test.maxDiscountCents / factor),
    Number(BigInt(primary.test.audience.maxCartTotalCents) * BigInt(discountBps) / 10000n));
  if (discountBps < 1 || maxDiscountCents < 1) return null;
  const result = structuredClone(primary);
  if (result.status !== "recommended") return null;
  result.alternative = { definition: "incentive-conservative-alternative-v1", sequence, sourceRecommendationHash: digest(primary) };
  result.test.discountPercent = discountBps / 100;
  result.test.maxDiscountCents = maxDiscountCents;
  if (result.test.kind === "capped_fixed_discount") result.test.fixedDiscountCents = maxDiscountCents;
  if (result.test.kind === "capped_shipping_discount") result.test.shippingDiscountCents = maxDiscountCents;
  if (result.test.delivery?.mode === "coupon_code") result.test.delivery.code = incentiveCouponCode(primary, sequence);
  result.test.limitCents = maxDiscountCents * result.test.maxRedemptions;
  result.planning = incentiveMeasurementPlanning(primary.planning.baseline, {
    asOf: new Date(Date.parse(primary.planning.baseline.windowEnd) + 7 * 86400000).toISOString(),
    maxDiscountCents, maxRedemptions: result.test.maxRedemptions,
  });
  return result;
}

function incentiveCouponCode(value: Pick<StrategyIncentiveRecommendation, "merchantId" | "runId" | "studyHash">, sequence = 0) {
  return `ZYON${digest(["weekly-incentive-coupon-v1", value.merchantId, value.runId, value.studyHash, sequence]).slice(0, 20).toUpperCase()}`;
}

/** Terms are chosen by the engine from a frozen study and merchant limits.
 * There is no endpoint accepting an arbitrary mode, amount or coupon code. */
export function commercialIncentiveRecommendation(study: StrategyDiscountStudy, rules: MerchantRules,
  policy: IncentivePolicySnapshot): StrategyIncentiveRecommendation {
  if (study.definition !== "weekly-discount-study-v2") throw new Error("STRATEGY_COMMERCIAL_STUDY_REQUIRED");
  const result = incentiveRecommendation(study, rules, policy);
  if (result.status !== "recommended") return { ...result, definition: "weekly-incentive-recommendation-v3" };
  const c = study.commercialCandidate;
  if (!c) throw new Error("STRATEGY_COMMERCIAL_STUDY_REQUIRED");
  const maxDiscountCents = Math.min(result.test.maxDiscountCents, c.maxDiscountCents);
  const maxRedemptions = Math.min(policy.maxRedemptions, Math.floor(policy.limitCents / maxDiscountCents));
  return { ...result, definition: "weekly-incentive-recommendation-v3", test: { ...result.test,
    kind: c.kind, maxDiscountCents, maxRedemptions, limitCents: maxDiscountCents * maxRedemptions,
    ...(c.kind === "capped_fixed_discount" ? { fixedDiscountCents: maxDiscountCents } : {}),
    ...(c.kind === "capped_shipping_discount" ? { shippingDiscountCents: maxDiscountCents } : {}),
    delivery: c.delivery === "coupon_code" ? { mode: "coupon_code", code: incentiveCouponCode(result) } : { mode: "automatic" } } };
}

export function plannedCommercialIncentiveRecommendation(study: StrategyDiscountStudy, rules: MerchantRules,
  policy: IncentivePolicySnapshot, baseline?: IncentivePlanningBaseline): StrategyIncentiveRecommendation {
  const result = commercialIncentiveRecommendation(study, rules, policy);
  if (result.status !== "recommended") return result;
  if (!baseline) throw new Error("STRATEGY_INCENTIVE_PLANNING_REQUIRED");
  const planning = incentiveMeasurementPlanning(baseline, { asOf: study.asOf,
    maxDiscountCents: result.test.maxDiscountCents, maxRedemptions: result.test.maxRedemptions });
  return { ...result, planning, test: { ...result.test,
    measurement: { ...result.test.measurement, samplePlanning: "included_in_recommendation" } } };
}

/** Authenticate an alternative against the immutable cycle artifact, including
 * its original baseline and policy. An alternate hash alone is not authority. */
export function incentiveRecommendationMatchesFrozen(value: StrategyIncentiveRecommendation,
  primary: StrategyIncentiveRecommendation): boolean {
  const expected = value?.alternative ? conservativeIncentiveAlternative(primary, value.alternative.sequence) : primary;
  return !!expected && digest(value) === digest(expected);
}

/** v1 remains byte-for-byte reproducible for historical proposals. A new cycle
 * captures v2 once; revisions cannot replan using later sales or budget limits. */
export function plannedIncentiveRecommendation(study: StrategyDiscountStudy, rules: MerchantRules,
  policy: IncentivePolicySnapshot, baseline?: IncentivePlanningBaseline): StrategyIncentiveRecommendation {
  const result = incentiveRecommendation(study, rules, policy);
  if (result.status === "not_recommended") return { ...result, definition: "weekly-incentive-recommendation-v2" };
  if (!baseline) throw new Error("STRATEGY_INCENTIVE_PLANNING_REQUIRED");
  const planning = incentiveMeasurementPlanning(baseline, { asOf: study.asOf,
    maxDiscountCents: result.test.maxDiscountCents, maxRedemptions: result.test.maxRedemptions });
  return { ...result, definition: "weekly-incentive-recommendation-v2", planning,
    test: { ...result.test, measurement: { ...result.test.measurement, samplePlanning: "included_in_recommendation" } } };
}
