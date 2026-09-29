import type { MerchantRules } from "@zyon/shared-types";
import { digest } from "../../experiments/domain/services/measurement-plan.js";
import { assertDiscountStudy, type StrategyDiscountStudy } from "./strategy-discount-study.js";

/** A reviewed funding envelope, not permission to issue an offer or to change
 * an existing communication experiment. Monetary values are integer BRL cents. */
export type IncentiveBudgetTerms = {
  definition: "strategy-incentive-budget-v1";
  scope: "funding_only";
  merchantId: string;
  strategyId: string;
  version: number;
  proposalHash: string;
  studyHash: string;
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
  study: StrategyDiscountStudy; rules: MerchantRules;
}): void {
  const invalid = () => { throw new Error("INCENTIVE_INVALID_BUDGET_TERMS"); };
  const iso = (v: string) => typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
  assertDiscountStudy(source.study, source.merchantId, source.study.runId, source.study.observationId, source.rules);
  if (!terms || source.study.status !== "candidate_available" || terms.definition !== "strategy-incentive-budget-v1"
    || terms.scope !== "funding_only" || terms.merchantId !== source.merchantId || terms.strategyId !== source.strategyId
    || !incentiveKey(terms.merchantId) || !incentiveKey(terms.strategyId)
    || terms.version !== source.version || !Number.isSafeInteger(terms.version) || terms.version < 1
    || !/^[a-f0-9]{64}$/.test(terms.proposalHash) || terms.proposalHash !== source.proposalHash
    || terms.studyHash !== digest(source.study) || terms.currency !== "BRL" || terms.maxPerBuyer !== 1
    || !incentiveCents(terms.limitCents) || !incentiveCents(terms.maxDiscountCents)
    || terms.maxDiscountCents > source.study.candidate.simulation.maxDiscountCents
    || terms.maxDiscountCents > terms.limitCents
    || !Number.isSafeInteger(terms.maxRedemptions) || terms.maxRedemptions < 1 || terms.maxRedemptions > 1_000_000
    || !iso(terms.startsAt) || !iso(terms.endsAt)
    || Date.parse(terms.endsAt) - Date.parse(terms.startsAt) !== 7 * 86_400_000) invalid();
  if (Object.keys(terms).sort().join() !== ["definition", "scope", "merchantId", "strategyId", "version", "proposalHash",
    "studyHash", "currency", "limitCents", "maxDiscountCents", "maxRedemptions", "maxPerBuyer", "startsAt", "endsAt"].sort().join()) invalid();
}

/** Explicit merchant limits are required; neither sample totals nor the LLM
 * supply a fallback budget. Callers must persist/present these exact terms. */
export function incentiveBudgetTerms(source: Parameters<typeof assertIncentiveBudgetTerms>[1], limits: {
  limitCents: number; maxDiscountCents: number; maxRedemptions: number; startsAt: string;
}): IncentiveBudgetTerms {
  const start = Date.parse(limits.startsAt);
  if (!Number.isFinite(start) || !Number.isFinite(start + 7 * 86_400_000)) throw new Error("INCENTIVE_INVALID_BUDGET_TERMS");
  const terms: IncentiveBudgetTerms = { definition: "strategy-incentive-budget-v1", scope: "funding_only",
    merchantId: source.merchantId, strategyId: source.strategyId, version: source.version, proposalHash: source.proposalHash,
    studyHash: digest(source.study), currency: "BRL", limitCents: limits.limitCents, maxDiscountCents: limits.maxDiscountCents,
    maxRedemptions: limits.maxRedemptions, maxPerBuyer: 1, startsAt: limits.startsAt,
    endsAt: new Date(start + 7 * 86_400_000).toISOString() };
  assertIncentiveBudgetTerms(terms, source);
  return terms;
}
