import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MERCHANT_RULES } from "@zyon/shared-types";
import { incentiveMeasurementPlanning, type IncentivePlanningBaseline } from "./incentive-measurement.js";
import { discountStudy } from "./strategy-discount-study.js";
import { incentivePolicySnapshot } from "./incentive-policy.js";
import { assertIncentiveRecommendation, incentiveRecommendation, plannedIncentiveRecommendation } from "./strategy-incentive-recommendation.js";

const asOf = "2026-09-29T00:00:00.000Z";
const baseline = (patch = {}): IncentivePlanningBaseline => ({ buyers: 10000, conversions: 10, complete: true,
  windowStart: "2026-08-25T00:00:00.000Z", windowEnd: "2026-09-22T00:00:00.000Z", ...patch });
const source = { asOf, maxDiscountCents: 400, maxRedemptions: 2000 };

test("automatic plan compares traffic and worst-case funding with a fixed effect independent of model lift", () => {
  const p = incentiveMeasurementPlanning(baseline(), source);
  assert.equal(p.status, "estimated_feasible");
  assert.deepEqual(p.blockers, []);
  assert.equal(p.weeklyBuyersPerArm, 1250);
  assert.equal(p.minimumBuyersPerArm, 936);
  assert.equal(p.requiredBudgetCents, 936 * 400);
  assert.equal(p.minimumEffectBps, 100);
  assert.equal(p.result, "not_measured");
  assert.equal(p.denominator, "all_assigned_buyers_including_non_purchasers");
});

test("budget covers every treatment assignment, never just expected conversions", () => {
  const p = incentiveMeasurementPlanning(baseline(), { ...source, maxRedemptions: 935 });
  assert.deepEqual(p.blockers, ["insufficient_budget"]);
  assert.equal(p.status, "blocked");
  assert.equal(incentiveMeasurementPlanning(baseline(), { ...source, maxRedemptions: 936 }).status, "estimated_feasible");
});

test("weekly cadence does not claim a conclusive experiment when traffic or budget is small", () => {
  const p = incentiveMeasurementPlanning(baseline({ buyers: 1000, conversions: 100 }), { ...source, maxRedemptions: 26 });
  assert.equal(p.minimumBuyersPerArm, 14751);
  assert.deepEqual(p.blockers, ["insufficient_weekly_traffic", "insufficient_budget"]);
  assert.equal(p.weeklyBuyersPerArm, 125);
});

for (const [patch, reason] of [
  [{ buyers: 0, conversions: 0, complete: false }, "incomplete_history"],
  [{ buyers: 30, conversions: 3 }, "insufficient_baseline"],
  [{ buyers: 100, conversions: 0 }, "unusable_conversion_rate"],
  [{ buyers: 100, conversions: 99 }, "unusable_conversion_rate"],
] as const) test(`planning distinguishes ${reason} without inventing a sample`, () => {
  const p = incentiveMeasurementPlanning(baseline(patch), source);
  assert.deepEqual(p.blockers, [reason]);
  assert.equal(p.minimumBuyersPerArm, null); assert.equal(p.requiredBudgetCents, null);
  assert.equal(p.weeklyBuyersPerArm, reason === "incomplete_history" ? null : Math.floor(patch.buyers / 8));
});

for (const patch of [{ buyers: -1 }, { buyers: 10001 }, { buyers: 100.5 }, { conversions: -1 }, { conversions: 10001 },
  { conversions: .5 }, { complete: false }, { complete: "true" }, { windowStart: "2026-08-26T00:00:00.000Z" },
  { windowEnd: asOf }, { windowStart: "bad" }, { buyerIds: ["private"] }]) {
  test(`planning rejects invalid counts, window or extra data ${JSON.stringify(patch)}`, () => {
    assert.throws(() => incentiveMeasurementPlanning(baseline(patch), source), /INVALID_PLANNING_BASELINE/);
  });
}

const rules = { ...DEFAULT_MERCHANT_RULES, autonomousEngineEnabled: true, maxDiscountPercent: 5, minimumMarginPercent: 30 };
const study = () => discountStudy({ merchantId: "store", runId: "run", observationId: "obs", asOf, capturedAt: asOf, rules,
  cohorts: [{ intent: "price_sensitive", sampleSize: 30, conversionRate: .1,
    carts: Array.from({ length: 30 }, () => ({ currency: "BRL", total: 100, items: [{ sku: "sku", name: "Produto", price: 100, cost: 40, quantity: 1 }] })) }] });
const policy = incentivePolicySnapshot("store", 1, { enabled: true, maxDiscountCents: 400, maxRedemptions: 2000, limitCents: 800000 });

test("v2 freezes exact baseline and reproducible planning while old v1 contracts remain valid", () => {
  const s = study(), old = incentiveRecommendation(s, rules, policy);
  assertIncentiveRecommendation(old, s, rules);
  assert.equal(old.definition, "weekly-incentive-recommendation-v1"); assert.equal(old.planning, undefined);
  const next = plannedIncentiveRecommendation(s, rules, policy, baseline());
  assert.equal(next.definition, "weekly-incentive-recommendation-v2");
  assert.equal(next.planning?.status, "estimated_feasible");
  assert.equal(next.test?.measurement.samplePlanning, "included_in_recommendation");
  assertIncentiveRecommendation(next, s, rules);
  assert.throws(() => plannedIncentiveRecommendation(s, rules, policy), /PLANNING_REQUIRED/);
});

for (const [name, mutate] of [
  ["sample", (p: any) => p.minimumBuyersPerArm = 1],
  ["effect", (p: any) => p.minimumEffectBps = 2000],
  ["denominator", (p: any) => p.denominator = "purchasers_only"],
  ["status", (p: any) => p.status = "blocked"],
  ["traffic", (p: any) => p.weeklyBuyersPerArm++],
  ["budget", (p: any) => p.requiredBudgetCents--],
  ["funded buyers", (p: any) => p.fundedTreatmentBuyers++],
  ["result", (p: any) => p.result = "positive"],
  ["horizon", (p: any) => p.durationDays = 14],
  ["extra fields", (p: any) => p.predictedLift = .1],
] as const) test(`recommendation rejects tampered ${name} planning`, () => {
  const s = study(), rec = plannedIncentiveRecommendation(s, rules, policy, baseline());
  mutate(rec.planning);
  assert.throws(() => assertIncentiveRecommendation(rec, s, rules), /INVALID_INCENTIVE_RECOMMENDATION/);
});

test("unavailable offers do not fabricate a statistical plan or accept an injected one", () => {
  const s = study(), disabled = incentivePolicySnapshot("store", 0, { enabled: false, maxDiscountCents: 0, maxRedemptions: 0, limitCents: 0 });
  const rec = plannedIncentiveRecommendation(s, rules, disabled);
  assert.equal(rec.planning, undefined); assertIncentiveRecommendation(rec, s, rules);
  rec.planning = incentiveMeasurementPlanning(baseline(), source);
  assert.throws(() => assertIncentiveRecommendation(rec, s, rules), /INVALID_INCENTIVE_RECOMMENDATION/);
});
