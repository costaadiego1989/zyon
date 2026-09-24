import test from "node:test";
import assert from "node:assert/strict";
import { assertMeasurementPlanning, assertStrategyExperimentReview, measurementPlanning, strategyExperimentReview } from "./strategy-measurement.js";
import { digest, fingerprintVariants } from "../../experiments/domain/services/measurement-plan.js";

const context = () => measurementPlanning({ merchantId: "merchant", runId: "run", asOf: "2030-09-01T00:00:00.000Z",
  capturedAt: "2030-09-01T00:00:01.000Z",
  policy: { durationDays: 7, conversionWindowHours: 24, minimumEffectBps: 500 },
  baseline: { sessions: 1000, conversions: 100, windowStart: "2030-08-03T00:00:00.000Z", windowEnd: "2030-08-31T00:00:00.000Z" } });
const recommendation = () => ({ hypothesis_text: "Explain the next step", reasoning: "Compare with current communication",
  expected_lift_percent: 1, template: { name: "Communication", description: "Contextual explanation",
    variant_a: { name: "Control", system_prompt: "baseline-reference", weight: 50, is_control: true },
    variant_b: { name: "Treatment", system_prompt: "Explain the next verified step", weight: 50, is_control: false } } });

test("planning keeps all assigned sessions and explicitly limits application to primary LLM turns", () => {
  const planning = context();
  assert.equal(planning.population.denominator, "all_assigned_sessions_including_no_llm_turn");
  assert.equal(planning.population.holdout, "excluded_from_assignment_and_exposure");
  assert.equal(planning.population.deterministicAndFallbackTurns, "baseline_only_not_exposed");
  assert.equal(planning.historicalBasis, "recorded_state_at_capture_not_exposure_evidence");
  assertMeasurementPlanning(planning, "merchant", "run");
});

test("planning rejects foreign tenant/cycle, non-mature windows and altered population", () => {
  for (const [merchant, run] of [["foreign", "run"], ["merchant", "other"]]) {
    assert.throws(() => assertMeasurementPlanning(context(), merchant, run), /STRATEGY_INVALID_MEASUREMENT_CONTEXT/);
  }
  assert.throws(() => measurementPlanning({ ...context(), asOf: "2030-08-31T00:00:00.000Z" }), /STRATEGY_INVALID_MEASUREMENT_CONTEXT/);
  const changed = context();
  (changed.population as any).denominator = "only_exposed_buyers";
  assert.throws(() => assertMeasurementPlanning(changed, "merchant", "run"), /STRATEGY_INVALID_MEASUREMENT_CONTEXT/);
});

test("model lift does not choose sample or effect and low capacity stays visible", () => {
  const source = recommendation();
  const first = strategyExperimentReview("strategy", 1, source, context());
  source.expected_lift_percent = 30;
  assert.deepEqual(strategyExperimentReview("strategy", 1, source, context()).plan, first.plan);
  assert.equal(first.plan.minimumEffectBps, 500);
  assert.ok(first.plan.minimumSessionsPerArm > 600);
  assert.equal(first.plan.trafficEstimate.sessionsPerArm, 125);
  assert.equal(first.capacity, "below_planned_sample");
  assert.equal(first.registration, "proposal_only_not_activated");
  assert.equal(first.planHash, digest(first.plan));
  assert.equal(first.plan.variantFingerprint, fingerprintVariants(first.variants));
});

test("revision reserves distinct variant identities while preserving the original planning cohort", () => {
  const first = strategyExperimentReview("strategy", 1, recommendation(), context());
  const second = strategyExperimentReview("strategy", 2, recommendation(), context());
  assert.notEqual(first.experimentId, second.experimentId);
  assert.notEqual(first.plan.variantFingerprint, second.plan.variantFingerprint);
  assert.equal(first.planningHash, second.planningHash);
  assert.equal(first.plan.minimumSessionsPerArm, second.plan.minimumSessionsPerArm);
  assertStrategyExperimentReview(second, "strategy", 2, recommendation(), "merchant", "run");
});

test("review validation detects altered treatment, variant identity, sample and hashes", () => {
  const review = strategyExperimentReview("strategy", 1, recommendation(), context());
  for (const alter of [
    (value: typeof review) => { value.plan.minimumSessionsPerArm = 10; },
    (value: typeof review) => { value.variants[1].systemPrompt = "Another instruction"; },
    (value: typeof review) => { value.variants[0].id = "other-control"; },
    (value: typeof review) => { value.planHash = "forged"; },
    (value: typeof review) => { value.planningHash = "forged"; },
  ]) {
    const copy = structuredClone(review); alter(copy);
    assert.throws(() => assertStrategyExperimentReview(copy, "strategy", 1, recommendation(), "merchant", "run"), /STRATEGY_INVALID_EXPERIMENT_REVIEW/);
  }
  assert.throws(() => assertStrategyExperimentReview(review, "strategy", 2, recommendation(), "merchant", "run"), /STRATEGY_INVALID_EXPERIMENT_REVIEW/);
});
