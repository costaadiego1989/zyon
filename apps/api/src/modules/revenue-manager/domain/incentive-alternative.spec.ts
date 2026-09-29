import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MERCHANT_RULES } from "@zyon/shared-types";
import { evaluateDiscountOffer } from "@zyon/rules-engine";
import { digest } from "../../experiments/domain/services/measurement-plan.js";
import { discountStudy } from "./strategy-discount-study.js";
import { incentivePolicySnapshot } from "./incentive-policy.js";
import { assertIncentiveRecommendation, conservativeIncentiveAlternative, incentiveRecommendationMatchesFrozen,
  plannedIncentiveRecommendation } from "./strategy-incentive-recommendation.js";

const rules = { ...DEFAULT_MERCHANT_RULES, autonomousEngineEnabled: true, maxDiscountPercent: 20, minimumMarginPercent: 35 };
const carts = Array.from({ length: 30 }, (_, i) => ({ total: 100 + i, currency: "BRL",
  items: [{ sku: "sku", name: "Produto", price: 100 + i, cost: 40 + i, quantity: 1 }] }));
const study = discountStudy({ merchantId: "store", runId: "run", observationId: "observation", rules,
  asOf: "2026-09-29T00:00:00.000Z", capturedAt: "2026-09-29T01:00:00.000Z",
  cohorts: [{ intent: "price_sensitive", sampleSize: 30, conversionRate: .01, carts }] });
const policy = incentivePolicySnapshot("store", 1, { enabled: true, limitCents: 800000, maxDiscountCents: 800, maxRedemptions: 1000 });
const baseline = { buyers: 10000, conversions: 10, complete: true, windowStart: "2026-08-25T00:00:00.000Z", windowEnd: "2026-09-22T00:00:00.000Z" };
const primary = plannedIncentiveRecommendation(study, rules, policy, baseline);

test("financial alternatives reduce real offer exposure while preserving every configured margin and frozen audience", () => {
  assert.equal(primary.status, "recommended");
  if (primary.status !== "recommended") return;
  const initial = digest(primary);
  let previousPercent = primary.test.discountPercent, previousLimit = primary.test.limitCents;
  for (const sequence of [1, 2, 3]) {
    const next = conservativeIncentiveAlternative(primary, sequence)!;
    assert.equal(next.status, "recommended");
    if (next.status !== "recommended") return;
    assert.ok(next.test.discountPercent < previousPercent); assert.ok(next.test.limitCents < previousLimit);
    assert.equal(next.test.limitCents, next.test.maxDiscountCents * next.test.maxRedemptions);
    assert.deepEqual(next.test.audience, primary.test.audience);
    assert.equal(next.test.maxRedemptions, primary.test.maxRedemptions);
    assert.equal(next.test.durationDays, 7); assert.equal(next.approval, "separate_incentive_review_required");
    assert.equal(next.execution, "unavailable"); assert.equal(next.budgetStatus, "not_reserved");
    assert.deepEqual(next.planning!.baseline, baseline);
    assert.equal(next.planning!.minimumBuyersPerArm, primary.planning!.minimumBuyersPerArm);
    assert.equal(next.planning!.requiredBudgetCents, next.planning!.minimumBuyersPerArm! * next.test.maxDiscountCents);
    for (const cart of carts) assert.equal(evaluateDiscountOffer(cart, rules, next.test.discountPercent, next.test.maxDiscountCents / 100).approved, true);
    assertIncentiveRecommendation(next, study, rules);
    assert.equal(incentiveRecommendationMatchesFrozen(next, primary), true);
    previousPercent = next.test.discountPercent; previousLimit = next.test.limitCents;
  }
  assert.equal(digest(primary), initial);
});

for (const [label, change] of [
  ["injected higher rate", (value: any) => value.test.discountPercent = 99],
  ["injected budget", (value: any) => value.test.limitCents++],
  ["different audience", (value: any) => value.test.audience.intent = "unknown"],
  ["source hash", (value: any) => value.alternative.sourceRecommendationHash = "f".repeat(64)],
  ["sequence", (value: any) => value.alternative.sequence++],
  ["baseline", (value: any) => value.planning.baseline.buyers--],
  ["margin", (value: any) => value.test.minimumMarginPercent--],
  ["authority", (value: any) => value.execution = "available"],
] as const) test(`financial alternative rejects ${label}`, () => {
  const value = conservativeIncentiveAlternative(primary, 1)!;
  change(value);
  assert.throws(() => assertIncentiveRecommendation(value, study, rules), /INVALID_INCENTIVE/);
  assert.equal(incentiveRecommendationMatchesFrozen(value, primary), false);
});

test("alternative sequence is bounded and cannot compound an already reduced artifact", () => {
  for (const sequence of [0, -1, 4, 1.5, NaN]) assert.equal(conservativeIncentiveAlternative(primary, sequence), null);
  assert.equal(conservativeIncentiveAlternative(conservativeIncentiveAlternative(primary, 1)!, 2), null);
  const tiny = plannedIncentiveRecommendation(study, rules, incentivePolicySnapshot("store", 1,
    { enabled: true, limitCents: 1, maxDiscountCents: 1, maxRedemptions: 1 }), baseline);
  assert.equal(conservativeIncentiveAlternative(tiny, 1), null);
});

test("alternative cannot be adopted by another store or a different cycle baseline", () => {
  const value = conservativeIncentiveAlternative(primary, 1)!;
  for (const source of [{ ...primary, merchantId: "other" }, { ...primary, runId: "other" },
    plannedIncentiveRecommendation(study, rules, policy, { ...baseline, conversions: 20 })]) {
    assert.equal(incentiveRecommendationMatchesFrozen(value, source), false);
  }
});
