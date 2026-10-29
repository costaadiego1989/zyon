import test from "node:test";
import assert from "node:assert/strict";
import { assessMeasurement, buildMeasurementPlan, conversionDifference, digest, requiredSample,
  type ArmMeasurement, type MeasurementEvidence } from "./measurement-plan.js";

const variants = [
  { id: "control", isControl: true, weight: 50, systemPrompt: "Current approved prompt", appliedRuleId: null },
  { id: "treatment", isControl: false, weight: 50, systemPrompt: "Explain the next step", appliedRuleId: null },
];
const input = { variants, durationDays: 7, conversionWindowHours: 24, minimumEffectBps: 500,
  baseline: { sessions: 1000, conversions: 100, windowStart: "2030-08-01T00:00:00Z", windowEnd: "2030-08-29T00:00:00Z" } };
const plan = buildMeasurementPlan(input);
const timing = { registeredAt: new Date("2030-08-30T00:00:00Z"), startedAt: new Date("2030-09-01T00:00:00Z"),
  completedAt: null, asOf: new Date("2030-09-09T00:00:00Z") };
const arm = (converted: number, assigned = 1000): ArmMeasurement => ({ assigned, mature: assigned, converted, orders: converted, revenueCents: converted * 10_000 });
const evidence = (c = 100, t = 200): MeasurementEvidence => ({ control: arm(c), treatment: arm(t), issues: [] });

test("registration freezes a single control, equal allocation and an absolute effect target", () => {
  assert.equal(plan.controlVariantId, "control");
  assert.equal(plan.treatmentVariantId, "treatment");
  assert.equal(plan.minimumSessionsPerArm, requiredSample(0.1, 0.05));
  assert.equal(plan.minimumEffectBps, 500);
  assert.deepEqual(plan.trafficEstimate, { sessionsPerArm: 125, reachesPlannedSample: false, basis: "previous_28_days" });
  assert.equal(digest(plan), digest(Object.fromEntries(Object.entries(plan).reverse())));
  assert.equal(digest({ x: { b: 2, a: 1 }, z: 3 }), digest({ z: 3, x: { a: 1, b: 2 } }));
});

test("invalid plans and invented or insufficient historical baselines are refused", () => {
  for (const patch of [ { durationDays: 6 }, { durationDays: 29 }, { durationDays: NaN },
    { conversionWindowHours: 0 }, { conversionWindowHours: 169 }, { minimumEffectBps: 0 },
    { baseline: { ...input.baseline, sessions: 99 } }, { baseline: { ...input.baseline, conversions: 0 } },
    { baseline: { ...input.baseline, conversions: 1000 } },
    { baseline: { ...input.baseline, windowStart: "2030-08-28T00:00:00Z" } },
    { variants: [variants[0], { ...variants[1], isControl: true }] },
    { variants: [variants[0], { ...variants[1], weight: 49 }] },
    { variants: [variants[0], { ...variants[1], appliedRuleId: "discount-rule" }] },
    { variants: [variants[0], { ...variants[1], id: "control" }] },
  ]) assert.throws(() => buildMeasurementPlan({ ...input, ...patch }));
});

test("fixed horizon and full conversion maturity prevent early declarations", () => {
  const strong = evidence(0, 1000);
  const collecting = assessMeasurement(plan, strong, { ...timing, asOf: new Date("2030-09-07T23:59:59Z") });
  assert.equal(collecting.state, "collecting"); assert.equal(collecting.interval, null);
  const pending = assessMeasurement(plan, strong, { ...timing, asOf: new Date("2030-09-08T23:59:59Z") });
  assert.equal(pending.state, "awaiting_maturity"); assert.equal(pending.interval, null);
  assert.equal(assessMeasurement(plan, strong, timing).state, "positive");
});

test("positive, negative and inconclusive conversion results never authorize promotion or profit", () => {
  const positive = assessMeasurement(plan, evidence(), timing);
  assert.equal(positive.state, "positive"); assert.ok(positive.interval!.lowerBps > 0);
  assert.equal(positive.promotionAllowed, false); assert.equal(positive.contributionCents, null); assert.equal(positive.aiCostCents, null);
  assert.equal(assessMeasurement(plan, evidence(200, 100), timing).state, "negative");
  assert.equal(assessMeasurement(plan, evidence(100, 100), timing).state, "inconclusive");
  const insufficient = { control: arm(1, 50), treatment: arm(50, 50), issues: [] };
  assert.deepEqual(assessMeasurement(plan, insufficient, timing).reasons, ["planned_sample_not_reached"]);
});

test("invalid populations, holdout, early stopping and post hoc plans cannot produce a winner", () => {
  for (const reason of ["holdout_contamination", "variant_definition_changed", "assignment_outside_fixed_horizon", "session_independence_unverified"]) {
    const result = assessMeasurement(plan, { ...evidence(), issues: [reason] }, timing);
    assert.equal(result.state, "invalid"); assert.equal(result.interval, null);
  }
  assert.equal(assessMeasurement(plan, evidence(), { ...timing, completedAt: new Date("2030-09-07T23:59:59Z") }).state, "invalid");
  assert.equal(assessMeasurement(plan, evidence(), { ...timing, registeredAt: new Date("2030-09-02Z") }).state, "invalid");
  assert.equal(assessMeasurement(plan, { ...evidence(), treatment: arm(200, 3000) }, timing).state, "invalid");
  assert.equal(assessMeasurement(plan, { ...evidence(), treatment: arm(2000, 1000) }, timing).state, "invalid");
  assert.equal(assessMeasurement(plan, { ...evidence(), treatment: { ...arm(200), revenueCents: Number.MAX_SAFE_INTEGER + 1 } }, timing).state, "invalid");
});

test("pending sessions remain in assignment counts without being treated as mature losses", () => {
  const result = assessMeasurement(plan, { ...evidence(), treatment: { ...arm(200), mature: 999 } }, timing);
  assert.equal(result.state, "awaiting_maturity"); assert.equal(result.treatment.assigned, 1000); assert.equal(result.interval, null);
  const empty = { control: arm(0, 0), treatment: arm(0, 0), issues: [] };
  assert.equal(assessMeasurement(plan, empty, { ...timing, startedAt: null }).state, "not_started");
});

test("Newcombe interval is symmetric on swapping arms and remains finite at zero/one rates", () => {
  const positive = conversionDifference(arm(100), arm(200));
  const negative = conversionDifference(arm(200), arm(100));
  assert.equal(positive.effectBps, -negative.effectBps);
  assert.ok(Math.abs(positive.lowerBps + negative.upperBps) < 1e-9);
  const endpoints = conversionDifference(arm(0), arm(1000));
  assert.ok(Object.values(endpoints).every(Number.isFinite));
  assert.equal(endpoints.upperBps, 10000);
  assert.throws(() => conversionDifference(arm(0, 0), arm(1000)), /EXPERIMENT_INVALID_BINOMIAL_COUNTS/);
  assert.throws(() => assessMeasurement(plan, evidence(), { ...timing, asOf: new Date(NaN) }), /EXPERIMENT_INVALID_REVIEW_TIME/);
});

test("intervals and planned sample match independent statsmodels 0.14.6 reference values", () => {
  // Generated outside this implementation with confint_proportions_2indep
  // (method='newcomb') and samplesize_proportions_2indep_onetail (two-sided).
  const references = [
    { c: 100, cn: 1000, t: 200, tn: 1000, lower: 0.06894934015909644, upper: 0.13104641439407827 },
    { c: 0, cn: 1000, t: 1000, tn: 1000, lower: 0.9945881462498017, upper: 1 },
    { c: 7, cn: 34, t: 1, tn: 34, lower: -0.3403686870327074, upper: -0.018921443885772937 },
    { c: 100, cn: 1000, t: 100, tn: 1000, lower: -0.02642326132263491, upper: 0.02642326132263491 },
  ];
  for (const r of references) {
    const interval = conversionDifference(arm(r.c, r.cn), arm(r.t, r.tn));
    assert.ok(Math.abs(interval.lowerBps / 10000 - r.lower) < 1e-12);
    assert.ok(Math.abs(interval.upperBps / 10000 - r.upper) < 1e-12);
  }
  for (const [p, effect, n] of [[0.1, 0.05, 686], [0.1, 0.01, 14751], [0.02, 0.01, 3826], [0.5, 0.05, 1565]]) {
    assert.equal(requiredSample(p, effect), n);
  }
});
