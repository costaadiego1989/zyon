import type { MerchantRules } from "@zyon/shared-types";
import { digest } from "../../experiments/domain/services/measurement-plan.js";
import { moneyCents } from "@zyon/rules-engine";
import { DiscountRuleHypothesisService, type CohortStats, type DiscountSimulation } from "./services/discount-rule-hypothesis.service.js";

/** An aggregate study, never an executable rule, coupon or spending authority. */
export type StrategyDiscountStudy = {
  definition: "weekly-discount-study-v1";
  merchantId: string;
  runId: string;
  observationId: string;
  asOf: string;
  capturedAt: string;
  policyHash: string;
  lookbackDays: 28;
  minimumBuyers: 30;
  population: "first-mature-session-per-consented-buyer-v1";
  approvalScope: "communication_only";
  commercialBudget: "not_reserved";
} & ({ status: "no_safe_candidate"; candidate?: never } | {
  status: "candidate_available";
  candidate: { intent: string; percent: number; simulation: DiscountSimulation };
});

export function discountStudy(input: { merchantId: string; runId: string; observationId: string;
  asOf: string; capturedAt: string; rules: MerchantRules; cohorts: CohortStats[] }): StrategyDiscountStudy {
  const candidate = new DiscountRuleHypothesisService().generate(input.cohorts, input.rules, 30);
  const study: StrategyDiscountStudy = {
    definition: "weekly-discount-study-v1", merchantId: input.merchantId, runId: input.runId,
    observationId: input.observationId, asOf: input.asOf, capturedAt: input.capturedAt,
    policyHash: digest(input.rules), lookbackDays: 28, minimumBuyers: 30,
    population: "first-mature-session-per-consented-buyer-v1", approvalScope: "communication_only",
    commercialBudget: "not_reserved",
    ...(candidate ? { status: "candidate_available" as const, candidate: {
      intent: candidate.rule.conditions[0].value as string,
      percent: Number(candidate.rule.action.params.percent), simulation: candidate.simulation,
    } } : { status: "no_safe_candidate" as const }),
  };
  assertDiscountStudy(study, input.merchantId, input.runId, input.observationId, input.rules);
  return structuredClone(study);
}

export function assertDiscountStudy(study: StrategyDiscountStudy, merchantId: string, runId: string,
  observationId: string, rules: MerchantRules): void {
  const invalid = () => { throw new Error("STRATEGY_INVALID_DISCOUNT_STUDY"); };
  const iso = (value: string) => typeof value === "string" && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
  if (!study || study.definition !== "weekly-discount-study-v1" || !merchantId || !runId || !observationId
    || study.merchantId !== merchantId || study.runId !== runId || study.observationId !== observationId
    || study.policyHash !== digest(rules) || study.lookbackDays !== 28 || study.minimumBuyers !== 30
    || study.population !== "first-mature-session-per-consented-buyer-v1"
    || study.approvalScope !== "communication_only" || study.commercialBudget !== "not_reserved"
    || !iso(study.asOf) || !iso(study.capturedAt) || study.capturedAt < study.asOf) invalid();
  const keys = ["definition", "merchantId", "runId", "observationId", "asOf", "capturedAt", "policyHash",
    "lookbackDays", "minimumBuyers", "population", "approvalScope", "commercialBudget", "status"];
  if (study.status === "candidate_available") {
    keys.push("candidate");
    const c = study.candidate, s = c?.simulation;
    const percent = moneyCents(c?.percent), cap = moneyCents(rules.maxDiscountPercent);
    if (!c || !s || !/^[a-z][a-z0-9_]{0,63}$/.test(c.intent) || percent === null || cap === null
      || percent <= 0 || percent > cap || cap > 10_000 || rules.autonomousEngineEnabled !== true
      || s.definition !== "discount-catalog-replay-v1" || s.currency !== "BRL" || s.conversionWindowHours !== 168
      || s.costBasis !== "current_catalog" || s.paymentFeeAssumptionPercent !== 4 || s.expectedLiftStatus !== "not_estimated"
      || !Number.isSafeInteger(s.sampleSize) || s.sampleSize < 30 || s.sampleSize > 10_000
      || !Number.isFinite(s.observedConversionRate) || s.observedConversionRate < 0 || s.observedConversionRate >= .15
      || !Number.isFinite(rules.minimumMarginPercent) || rules.minimumMarginPercent < 0 || rules.minimumMarginPercent > 100
      || !Number.isFinite(s.minimumProjectedMarginPercent) || s.minimumProjectedMarginPercent > 100
      || s.minimumProjectedMarginPercent + 1e-9 < rules.minimumMarginPercent
      || [s.minCartTotalCents, s.maxCartTotalCents, s.maxDiscountCents, s.replayDiscountTotalCents]
        .some(n => !Number.isSafeInteger(n) || n <= 0)
      || s.minCartTotalCents > s.maxCartTotalCents || s.maxDiscountCents > s.maxCartTotalCents
      || BigInt(s.maxDiscountCents) !== BigInt(s.maxCartTotalCents) * BigInt(percent) / 10_000n
      || s.replayDiscountTotalCents < s.sampleSize
      || BigInt(s.replayDiscountTotalCents) > BigInt(s.sampleSize) * BigInt(s.maxDiscountCents)) invalid();
    if (Object.keys(c).sort().join() !== ["intent", "percent", "simulation"].sort().join()
      || Object.keys(s).sort().join() !== ["definition", "currency", "sampleSize", "conversionWindowHours",
        "observedConversionRate", "costBasis", "paymentFeeAssumptionPercent", "minimumProjectedMarginPercent",
        "minCartTotalCents", "maxCartTotalCents", "maxDiscountCents", "replayDiscountTotalCents", "expectedLiftStatus"].sort().join()) invalid();
  } else if (study.status !== "no_safe_candidate") invalid();
  if (Object.keys(study).sort().join() !== keys.sort().join()) invalid();
}
