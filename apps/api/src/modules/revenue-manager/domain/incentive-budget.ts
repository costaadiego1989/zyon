import type { MerchantRules } from "@zyon/shared-types";
import { digest } from "../../experiments/domain/services/measurement-plan.js";
import { assertDiscountStudy, type StrategyDiscountStudy } from "./strategy-discount-study.js";
import { incentivePolicySnapshot, type IncentivePolicySnapshot } from "./incentive-policy.js";
import { assertIncentiveRecommendation, type StrategyIncentiveRecommendation } from "./strategy-incentive-recommendation.js";

/** A reviewed funding envelope, not permission to issue an offer or to change
 * an existing communication experiment. Monetary values are integer BRL cents. */
export type IncentiveBudgetTerms = {
  definition: "strategy-incentive-budget-v2";
  scope: "funding_only";
  merchantId: string;
  strategyId: string;
  version: number;
  proposalHash: string;
  studyHash: string;
  policyVersion: number;
  policyHash: string;
  currency: "BRL";
  limitCents: number;
  maxDiscountCents: number;
  maxRedemptions: number;
  maxPerBuyer: 1;
  startsAt: string;
  endsAt: string;
};

export const MAX_INCENTIVE_CENTS = 2_147_483_647;
export const incentiveKey = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9:_-]{1,150}$/.test(v);
export const incentiveCents = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= MAX_INCENTIVE_CENTS;

export function assertIncentiveBudgetTerms(terms: IncentiveBudgetTerms, source: {
  merchantId: string; strategyId: string; version: number; proposalHash: string;
  study: StrategyDiscountStudy; rules: MerchantRules; policy: IncentivePolicySnapshot;
}): void {
  const invalid = () => { throw new Error("INCENTIVE_INVALID_BUDGET_TERMS"); };
  const iso = (v: string) => typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
  assertDiscountStudy(source.study, source.merchantId, source.study.runId, source.study.observationId, source.rules);
  const p = source.policy;
  if (!p || !p.enabled || p.merchantId !== source.merchantId || p.version < 1
    || p.policyHash !== incentivePolicySnapshot(p.merchantId, p.version, p).policyHash) invalid();
  if (!terms || source.study.status !== "candidate_available" || terms.definition !== "strategy-incentive-budget-v2"
    || terms.scope !== "funding_only" || terms.merchantId !== source.merchantId || terms.strategyId !== source.strategyId
    || !incentiveKey(terms.merchantId) || !incentiveKey(terms.strategyId)
    || terms.version !== source.version || !Number.isSafeInteger(terms.version) || terms.version < 1
    || !/^[a-f0-9]{64}$/.test(terms.proposalHash) || terms.proposalHash !== source.proposalHash
    || terms.studyHash !== digest(source.study) || terms.currency !== "BRL" || terms.maxPerBuyer !== 1
    || terms.policyVersion !== p.version || terms.policyHash !== p.policyHash
    || terms.limitCents > p.limitCents || terms.maxDiscountCents > p.maxDiscountCents || terms.maxRedemptions > p.maxRedemptions
    || !incentiveCents(terms.limitCents) || !incentiveCents(terms.maxDiscountCents)
    || terms.maxDiscountCents > source.study.candidate.simulation.maxDiscountCents
    || terms.maxDiscountCents > terms.limitCents
    || !Number.isSafeInteger(terms.maxRedemptions) || terms.maxRedemptions < 1 || terms.maxRedemptions > 1_000_000
    || !iso(terms.startsAt) || !iso(terms.endsAt)
    || Date.parse(terms.endsAt) - Date.parse(terms.startsAt) !== 7 * 86_400_000) invalid();
  if (Object.keys(terms).sort().join() !== ["definition", "scope", "merchantId", "strategyId", "version", "proposalHash",
    "studyHash", "policyVersion", "policyHash", "currency", "limitCents", "maxDiscountCents", "maxRedemptions", "maxPerBuyer", "startsAt", "endsAt"].sort().join()) invalid();
}

/** Explicit merchant limits are required; neither sample totals nor the LLM
 * supply a fallback budget. Callers must persist/present these exact terms. */
export function incentiveBudgetTerms(source: Parameters<typeof assertIncentiveBudgetTerms>[1], limits: {
  limitCents: number; maxDiscountCents: number; maxRedemptions: number; startsAt: string;
}): IncentiveBudgetTerms {
  const start = Date.parse(limits.startsAt);
  if (!Number.isFinite(start) || !Number.isFinite(start + 7 * 86_400_000)) throw new Error("INCENTIVE_INVALID_BUDGET_TERMS");
  const terms: IncentiveBudgetTerms = { definition: "strategy-incentive-budget-v2", scope: "funding_only",
    merchantId: source.merchantId, strategyId: source.strategyId, version: source.version, proposalHash: source.proposalHash,
    studyHash: digest(source.study), policyVersion: source.policy.version, policyHash: source.policy.policyHash,
    currency: "BRL", limitCents: limits.limitCents, maxDiscountCents: limits.maxDiscountCents,
    maxRedemptions: limits.maxRedemptions, maxPerBuyer: 1, startsAt: limits.startsAt,
    endsAt: new Date(start + 7 * 86_400_000).toISOString() };
  assertIncentiveBudgetTerms(terms, source);
  return terms;
}

type RecommendedFundingSource = Parameters<typeof assertIncentiveBudgetTerms>[1] & {
  recommendation?: StrategyIncentiveRecommendation;
};

/** New funding is derived from the frozen AI recommendation. A merchant review
 * chooses whether to accept; it never supplies an alternative discount/budget.
 * This is still accounting only, not checkout activation or offer authority. */
export function recommendedIncentiveBudgetTerms(source: RecommendedFundingSource, startsAt: string): IncentiveBudgetTerms {
  const recommendation = source.recommendation;
  if (!recommendation || !["weekly-incentive-recommendation-v2", "weekly-incentive-recommendation-v3"].includes(recommendation.definition)
    || recommendation.status !== "recommended") throw new Error("INCENTIVE_PLANNED_RECOMMENDATION_REQUIRED");
  assertIncentiveRecommendation(recommendation, source.study, source.rules);
  if (digest(recommendation.financialPolicy) !== digest(source.policy)) throw new Error("INCENTIVE_POLICY_CHANGED");
  if (recommendation.planning?.status !== "estimated_feasible") throw new Error("INCENTIVE_MEASUREMENT_BLOCKED");
  return incentiveBudgetTerms(source, { limitCents: recommendation.test.limitCents,
    maxDiscountCents: recommendation.test.maxDiscountCents, maxRedemptions: recommendation.test.maxRedemptions, startsAt });
}

export function assertRecommendedIncentiveBudgetTerms(terms: IncentiveBudgetTerms, source: RecommendedFundingSource) {
  if (digest(terms) !== digest(recommendedIncentiveBudgetTerms(source, terms.startsAt))) {
    throw new Error("INCENTIVE_RECOMMENDED_TERMS_CHANGED");
  }
}
