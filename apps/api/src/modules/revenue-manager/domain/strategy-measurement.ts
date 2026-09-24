import { buildMeasurementPlan, digest, type MeasurementPlan, type MeasurementVariant } from "../../experiments/domain/services/measurement-plan.js";
import type { HypothesisGenerationResponse } from "./ports/hypothesis-generator.port.js";

/** Intent-to-treat at session creation. Reaching the LLM is an outcome of the
 * checkout journey, never a retrospective condition for entering the denominator. */
export const STRATEGY_POPULATION = {
  definition: "checkout-first-session-per-buyer-v1",
  unit: "checkout_session",
  currency: "BRL",
  cohort: "treatment",
  identity: "nonempty_global_user_id",
  enrollment: "first_eligible_session_per_buyer_in_enrollment_window",
  assignment: "before_first_chat_turn",
  denominator: "all_assigned_sessions_including_no_llm_turn",
  application: "primary_llm_turn_only",
  deterministicAndFallbackTurns: "baseline_only_not_exposed",
  holdout: "excluded_from_assignment_and_exposure",
  conversion: "approved_brl_order_for_assigned_session_within_window",
} as const;

export type MeasurementPolicy = Pick<MeasurementPlan, "durationDays" | "conversionWindowHours" | "minimumEffectBps">;
export type StrategyMeasurementPlanning = {
  definition: "checkout-strategy-measurement-planning-v1";
  merchantId: string;
  runId: string;
  asOf: string;
  capturedAt: string;
  population: typeof STRATEGY_POPULATION;
  policy: MeasurementPolicy;
  baseline: MeasurementPlan["baseline"];
  historicalBasis: "recorded_state_at_capture_not_exposure_evidence";
};

const planningArms: MeasurementVariant[] = [
  { id: "planning-control", isControl: true, weight: 50, systemPrompt: "control", appliedRuleId: null },
  { id: "planning-treatment", isControl: false, weight: 50, systemPrompt: "treatment", appliedRuleId: null },
];

export function measurementPlanning(input: Pick<StrategyMeasurementPlanning, "merchantId" | "runId" | "asOf" | "capturedAt" | "policy" | "baseline">): StrategyMeasurementPlanning {
  if (!input.merchantId || !input.runId || !Number.isFinite(Date.parse(input.asOf))
    || !Number.isFinite(Date.parse(input.capturedAt)) || Date.parse(input.capturedAt) < Date.parse(input.asOf)
    || Date.parse(input.baseline.windowEnd) !== Date.parse(input.asOf) - input.policy.conversionWindowHours * 3_600_000) {
    throw new Error("STRATEGY_INVALID_MEASUREMENT_CONTEXT");
  }
  // Reuse the registered fixed-horizon calculation; no LLM-chosen sample or MDE.
  buildMeasurementPlan({ ...input.policy, baseline: input.baseline, variants: planningArms });
  return structuredClone({ definition: "checkout-strategy-measurement-planning-v1", ...input,
    population: STRATEGY_POPULATION, historicalBasis: "recorded_state_at_capture_not_exposure_evidence" });
}

export function assertMeasurementPlanning(value: StrategyMeasurementPlanning, merchantId: string, runId: string) {
  if (value.merchantId !== merchantId || value.runId !== runId || digest(value) !== digest(measurementPlanning({
    merchantId: value.merchantId, runId: value.runId, asOf: value.asOf, capturedAt: value.capturedAt, policy: value.policy, baseline: value.baseline,
  }))) throw new Error("STRATEGY_INVALID_MEASUREMENT_CONTEXT");
}

export type StrategyExperimentReview = {
  definition: "checkout-strategy-experiment-review-v1";
  strategyId: string;
  version: number;
  experimentId: string;
  name: string;
  description: string;
  variants: Array<MeasurementVariant & { name: string }>;
  planning: StrategyMeasurementPlanning;
  planningHash: string;
  plan: MeasurementPlan;
  planHash: string;
  registration: "proposal_only_not_activated";
  capacity: "estimated_sufficient" | "below_planned_sample";
};

export function strategyExperimentReview(strategyId: string, version: number, recommendation: HypothesisGenerationResponse,
  planning: StrategyMeasurementPlanning): StrategyExperimentReview {
  if (!strategyId || !Number.isSafeInteger(version) || version < 1) throw new Error("STRATEGY_INVALID_EXPERIMENT_VERSION");
  assertMeasurementPlanning(planning, planning.merchantId, planning.runId);
  // IDs are reserved in the proposal, not rows that legacy APIs can activate.
  const experimentId = `strategy-test-${digest({ merchantId: planning.merchantId, strategyId, version })}`;
  const variants = [recommendation.template.variant_a, recommendation.template.variant_b].map((v, i) => ({
    id: `${experimentId}-${i === 0 ? "control" : "treatment"}`, name: v.name, isControl: v.is_control,
    weight: v.weight, systemPrompt: v.system_prompt, appliedRuleId: null,
  }));
  const plan = buildMeasurementPlan({ ...planning.policy, baseline: planning.baseline, variants });
  return structuredClone({ definition: "checkout-strategy-experiment-review-v1", strategyId, version, experimentId,
    name: recommendation.template.name, description: recommendation.template.description, variants,
    planning, planningHash: digest(planning), plan, planHash: digest(plan), registration: "proposal_only_not_activated",
    capacity: plan.trafficEstimate.reachesPlannedSample ? "estimated_sufficient" : "below_planned_sample" });
}

export function assertStrategyExperimentReview(review: StrategyExperimentReview, strategyId: string, version: number,
  recommendation: HypothesisGenerationResponse, merchantId: string, runId: string) {
  assertMeasurementPlanning(review.planning, merchantId, runId);
  if (digest(review) !== digest(strategyExperimentReview(strategyId, version, recommendation, review.planning))) {
    throw new Error("STRATEGY_INVALID_EXPERIMENT_REVIEW");
  }
}

export class MeasurementBaselineUnavailable extends Error {
  constructor() { super("STRATEGY_MEASUREMENT_BASELINE_INSUFFICIENT"); }
}
