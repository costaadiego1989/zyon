import { requiredSample } from "../../experiments/domain/services/measurement-plan.js";

/** Counts from a complete, mature, tenant-owned history. Never inferred from
 * the simulation's rounded rate or supplied by the model/merchant browser. */
export type IncentivePlanningBaseline = {
  buyers: number; conversions: number; complete: boolean;
  windowStart: string; windowEnd: string;
};
export type IncentiveMeasurementPlanning = {
  definition: "incentive-fixed-horizon-planning-v1";
  baseline: IncentivePlanningBaseline;
  historicalBasis: "recorded_state_at_capture_not_exposure_evidence";
  population: "first_mature_session_per_consented_buyer_matching_offer_treatment_cohort";
  denominator: "all_assigned_buyers_including_non_purchasers";
  metric: "approved_order_conversion_per_assigned_buyer";
  durationDays: 7; conversionWindowHours: 168; allocation: "50/50";
  minimumEffectBps: 100; effectBasis: "fixed_absolute_planning_threshold_not_forecast";
  confidence: 0.95; planningPower: 0.8; inference: "newcombe-wilson-two-sided";
  minimumBuyersPerArm: number | null;
  weeklyBuyersPerArm: number | null;
  fundedTreatmentBuyers: number;
  fundingBasis: "maximum_discount_for_every_assigned_treatment_buyer";
  requiredBudgetCents: number | null;
  status: "blocked" | "estimated_feasible";
  blockers: Array<"incomplete_history" | "insufficient_baseline" | "unusable_conversion_rate"
    | "sample_not_feasible" | "insufficient_weekly_traffic" | "insufficient_budget">;
  result: "not_measured";
};

export function incentiveMeasurementPlanning(baseline: IncentivePlanningBaseline, source: {
  asOf: string; maxDiscountCents: number; maxRedemptions: number;
}): IncentiveMeasurementPlanning {
  const invalid = () => { throw new Error("INCENTIVE_INVALID_PLANNING_BASELINE"); };
  const iso = (s: string) => typeof s === "string" && Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s;
  if (!baseline || !iso(source.asOf) || !iso(baseline.windowStart) || !iso(baseline.windowEnd)
    || Date.parse(baseline.windowEnd) !== Date.parse(source.asOf) - 7 * 86_400_000
    || Date.parse(baseline.windowEnd) - Date.parse(baseline.windowStart) !== 28 * 86_400_000
    || typeof baseline.complete !== "boolean" || !Number.isSafeInteger(baseline.buyers) || baseline.buyers < 0 || baseline.buyers > 10_000
    || !Number.isSafeInteger(baseline.conversions) || baseline.conversions < 0 || baseline.conversions > baseline.buyers
    || (!baseline.complete && (baseline.buyers !== 0 || baseline.conversions !== 0))
    || Object.keys(baseline).sort().join() !== ["buyers", "complete", "conversions", "windowEnd", "windowStart"].join()
    || !Number.isSafeInteger(source.maxDiscountCents) || source.maxDiscountCents < 1 || source.maxDiscountCents > 2_147_483_647
    || !Number.isSafeInteger(source.maxRedemptions) || source.maxRedemptions < 1 || source.maxRedemptions > 1_000_000) invalid();
  const blockers: IncentiveMeasurementPlanning["blockers"] = [];
  let minimumBuyersPerArm: number | null = null;
  if (!baseline.complete) blockers.push("incomplete_history");
  else if (baseline.buyers < 100) blockers.push("insufficient_baseline");
  else if (baseline.conversions <= 0 || baseline.conversions / baseline.buyers + .01 >= 1) blockers.push("unusable_conversion_rate");
  else {
    try { minimumBuyersPerArm = requiredSample(baseline.conversions / baseline.buyers, .01); }
    catch (error) {
      if (!(error instanceof Error) || error.message !== "EXPERIMENT_SAMPLE_NOT_FEASIBLE") throw error;
      blockers.push("sample_not_feasible");
    }
  }
  const weeklyBuyersPerArm = baseline.complete ? Math.floor(baseline.buyers / 8) : null;
  if (minimumBuyersPerArm !== null) {
    if (weeklyBuyersPerArm! < minimumBuyersPerArm) blockers.push("insufficient_weekly_traffic");
    if (source.maxRedemptions < minimumBuyersPerArm) blockers.push("insufficient_budget");
  }
  return { definition: "incentive-fixed-horizon-planning-v1", baseline: structuredClone(baseline),
    historicalBasis: "recorded_state_at_capture_not_exposure_evidence",
    population: "first_mature_session_per_consented_buyer_matching_offer_treatment_cohort",
    denominator: "all_assigned_buyers_including_non_purchasers", metric: "approved_order_conversion_per_assigned_buyer",
    durationDays: 7, conversionWindowHours: 168, allocation: "50/50", minimumEffectBps: 100,
    effectBasis: "fixed_absolute_planning_threshold_not_forecast", confidence: .95, planningPower: .8,
    inference: "newcombe-wilson-two-sided", minimumBuyersPerArm, weeklyBuyersPerArm,
    fundedTreatmentBuyers: source.maxRedemptions, fundingBasis: "maximum_discount_for_every_assigned_treatment_buyer",
    requiredBudgetCents: minimumBuyersPerArm === null ? null : minimumBuyersPerArm * source.maxDiscountCents,
    status: blockers.length ? "blocked" : "estimated_feasible", blockers, result: "not_measured" };
}
