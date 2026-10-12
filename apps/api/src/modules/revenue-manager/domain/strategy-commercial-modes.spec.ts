import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MERCHANT_RULES, type Cart, type ShippingQuote } from "@zyon/shared-types";
import { commercialDiscountStudy, assertDiscountStudy, plannerDiscountStudy } from "./strategy-discount-study.js";
import { assertIncentiveRecommendation, plannedCommercialIncentiveRecommendation, plannedSelectedIncentiveRecommendation,
  conservativeIncentiveAlternative, progressiveIncentiveStages } from "./strategy-incentive-recommendation.js";
import { incentivePolicySnapshot } from "./incentive-policy.js";
import { assessExecutableIncentive } from "./executable-incentive.js";

const rules = { ...DEFAULT_MERCHANT_RULES, autonomousEngineEnabled: true, couponBoxEnabled: true,
  maxDiscountPercent: 10, minimumMarginPercent: 35, allowShippingDiscount: true,
  maxPartialShippingDiscount: 8, maxShippingSubsidy: 8, allowFreeShipping: false };
const cart = (total = 100, cost = 40): Cart => ({ total, currency: "BRL", items: [{ sku: "sku", name: "Produto", price: total, cost, quantity: 1 }] });
const policy = incentivePolicySnapshot("store", 1, { enabled: true, limitCents: 500000, maxDiscountCents: 500, maxRedemptions: 1000 });
const baseline = { buyers: 10000, conversions: 10, complete: true, windowStart: "2026-08-31T00:00:00.000Z", windowEnd: "2026-09-28T00:00:00.000Z" };

test("v4 progressive stages are executable frozen targets, with conservative integer rounding and no stacking", () => {
  const study = plannerDiscountStudy({ merchantId: "store", runId: "run", observationId: "obs", rules,
    asOf: "2026-10-05T00:00:00.000Z", capturedAt: "2026-10-05T01:00:00.000Z",
    cohorts: [{ intent: "price_sensitive", sampleSize: 30, conversionRate: .1, carts: Array.from({ length: 30 }, () => cart()) }] });
  const r = plannedSelectedIncentiveRecommendation(study, rules, policy, baseline, "progressive");
  assertIncentiveRecommendation(r, study, rules);
  assert.equal(assessExecutableIncentive(cart(), rules, r, { customerPrice: 10, realCost: 10 }, 0)?.amountCents, 250);
  assert.equal(assessExecutableIncentive(cart(), rules, r, { customerPrice: 10, realCost: 10 }, 1)?.amountCents, 500);
  assert.equal(assessExecutableIncentive({ ...cart(), currentDiscount: 2.5 }, rules, r, { customerPrice: 10, realCost: 10 }, 1), null);
  assert.equal(assessExecutableIncentive(cart(), rules, r, { customerPrice: 0, realCost: 10 }, 1), null);
  assert.deepEqual(progressiveIncentiveStages(5.01, 501), [
    { index: 0, trigger: "enrollment", discountPercent: 2.5, maxDiscountCents: 250 },
    { index: 1, trigger: "checkout_payment_ready", discountPercent: 5.01, maxDiscountCents: 501 },
  ]);
  assert.equal(progressiveIncentiveStages(.01, 100), null);
  assert.equal(progressiveIncentiveStages(5, 1), null);
  for (const alter of [
    (v: any) => v.test.stages[0].maxDiscountCents++,
    (v: any) => v.test.stages[1].trigger = "checkout_abandoned",
    (v: any) => v.test.stages.push(v.test.stages[1]),
    (v: any) => v.test.delivery = { mode: "coupon_code", code: "ZYON" + "F".repeat(20) },
  ]) {
    const forged = structuredClone(r); alter(forged);
    assert.throws(() => assertIncentiveRecommendation(forged, study, rules));
    assert.equal(assessExecutableIncentive(cart(), rules, forged, { customerPrice: 10, realCost: 10 }, 1), null);
  }
  const reduced = conservativeIncentiveAlternative(r, 1)!;
  assertIncentiveRecommendation(reduced, study, rules);
  assert.equal(assessExecutableIncentive(cart(), rules, reduced, { customerPrice: 10, realCost: 10 }, 0)?.amountCents, 125);
});
function terms(kind: "fixed" | "percentage" | "shipping", quote: ShippingQuote | undefined = { customerPrice: 20, realCost: 20 }) {
  const study = commercialDiscountStudy({ merchantId: "store", runId: "run", observationId: "obs", rules,
    asOf: "2026-10-05T00:00:00.000Z", capturedAt: "2026-10-05T01:00:00.000Z",
    cohorts: [{ intent: "price_sensitive", sampleSize: 30, conversionRate: .1,
      carts: Array.from({ length: 30 }, (_, i) => cart(kind === "percentage" && i % 2 ? 200 : 100)),
      ...(kind === "shipping" ? { shipping: Array.from({ length: 30 }, () => quote) } : {}) }] });
  return { study, recommendation: plannedCommercialIncentiveRecommendation(study, rules, policy, baseline) };
}

for (const [mode, expected] of [["fixed", "capped_fixed_discount"], ["percentage", "capped_percentage_discount"], ["shipping", "capped_shipping_discount"]] as const) {
  test(`v3 selects ${mode} from frozen economic evidence and preserves separate approval and planning`, () => {
    const { study, recommendation: r } = terms(mode);
    assert.equal(r.definition, "weekly-incentive-recommendation-v3");
    assert.equal(r.status, "recommended"); if (r.status !== "recommended") return;
    assert.equal(r.test.kind, expected); assert.equal(r.test.maxDiscountCents, 500);
    assert.equal(r.test.limitCents, r.test.maxRedemptions * 500);
    assert.equal(r.test.measurement.samplePlanning, "included_in_recommendation");
    assert.equal(r.approval, "separate_incentive_review_required");
    assert.equal(r.planning?.status, "estimated_feasible");
    assertIncentiveRecommendation(r, study, rules);
    assert.equal(assessExecutableIncentive(cart(), rules, r, { customerPrice: 20, realCost: 20 })?.amountCents, 500);
  });
}

test("missing shipping costs, insufficient burden and forbidden regions never become a freight proposal", () => {
  for (const quote of [{ customerPrice: 20 }, { customerPrice: 1, realCost: 1 }]) {
    const r = terms("shipping", quote).recommendation;
    assert.ok(r.status === "recommended" && r.test.kind !== "capped_shipping_discount");
  }
  const { recommendation } = terms("shipping");
  assert.equal(assessExecutableIncentive(cart(), rules, recommendation, { customerPrice: 20 }), null);
  assert.equal(assessExecutableIncentive(cart(), { ...rules, blockedRegions: ["SP"] }, recommendation,
    { customerPrice: 20, realCost: 20, region: "SP" }), null);
});

test("freight runtime preserves carrier subsidy, free-shipping eligibility and complete order margin", () => {
  const r = terms("shipping").recommendation;
  assert.equal(assessExecutableIncentive(cart(), rules, r, { customerPrice: 3, realCost: 3 }), null);
  assert.equal(assessExecutableIncentive(cart(), rules, r, { customerPrice: 20, realCost: 30 }), null);
  assert.equal(assessExecutableIncentive(cart(100, 60), rules, r, { customerPrice: 20, realCost: 20 }), null);
  assert.equal(assessExecutableIncentive(cart(), { ...rules, allowShippingDiscount: false }, r,
    { customerPrice: 20, realCost: 20 }), null);
});

test("fixed coupon is deterministic without personal information and cannot exceed the percent floor", () => {
  const r = terms("fixed").recommendation;
  assert.ok(r.status === "recommended" && r.test.delivery?.mode === "coupon_code");
  if (r.status !== "recommended" || r.test.delivery?.mode !== "coupon_code") return;
  assert.match(r.test.delivery.code, /^ZYON[A-F0-9]{20}$/);
  assert.deepEqual(terms("fixed").recommendation, r);
  const low = { ...r, test: { ...r.test, audience: { ...r.test.audience, minCartTotalCents: 1 } } };
  assert.equal(assessExecutableIncentive(cart(10, 1), rules, low), null);
  assert.equal(assessExecutableIncentive({ ...cart(), currentDiscount: 1 }, rules, r), null);
  assert.equal(assessExecutableIncentive(cart(100, 80), rules, r), null);
});

for (const mode of ["fixed", "shipping", "percentage"] as const) test(`${mode} never stacks a new incentive with pre-subsidized shipping`, () => {
  const r = terms(mode).recommendation;
  assert.equal(assessExecutableIncentive(cart(100, 1), rules, r, { customerPrice: 0, realCost: 10 }), null);
  assert.equal(assessExecutableIncentive(cart(100, 1), rules, r, { customerPrice: 20, realCost: 21 }), null);
});

for (const mode of ["fixed", "shipping", "percentage"] as const) test(`conservative ${mode} alternatives retain frozen evidence and reduce authority`, () => {
  const { study, recommendation: primary } = terms(mode);
  assert.ok(primary.status === "recommended"); if (primary.status !== "recommended") return;
  for (let sequence = 1; sequence <= 3; sequence++) {
    const r = conservativeIncentiveAlternative(primary, sequence);
    assert.ok(r?.status === "recommended"); if (!r || r.status !== "recommended") return;
    assert.ok(r.test.maxDiscountCents < primary.test.maxDiscountCents);
    assert.ok(r.test.discountPercent < primary.test.discountPercent);
    assertIncentiveRecommendation(r, study, rules);
    if (r.test.delivery?.mode === "coupon_code" && primary.test.delivery?.mode === "coupon_code") {
      assert.notEqual(r.test.delivery.code, primary.test.delivery.code);
    }
  }
});

for (const mutate of [
  (r: any) => r.test.fixedDiscountCents++, (r: any) => r.test.delivery.code = "PUBLIC",
  (r: any) => r.test.delivery = { mode: "automatic" }, (r: any) => r.test.kind = "capped_shipping_discount",
  (r: any) => r.definition = "weekly-incentive-recommendation-v2", (r: any) => r.planning.baseline.buyers = 20000,
]) test("v3 rejects edits to approved modality, delivery and captured planning", () => {
  const { study, recommendation } = terms("fixed"); mutate(recommendation);
  assert.throws(() => assertIncentiveRecommendation(recommendation, study, rules));
});

test("commercial evidence carries no raw carts and rejects a missing or inflated shipping sample", () => {
  const { study } = terms("shipping");
  assert.equal(JSON.stringify(study).includes('"items"'), false);
  const changed = structuredClone(study); changed.commercialCandidate!.evidence.sampleSize = 29;
  assert.throws(() => assertDiscountStudy(changed, "store", "run", "obs", rules));
  const missing = { ...study }; delete missing.commercialCandidate;
  assert.throws(() => assertDiscountStudy(missing, "store", "run", "obs", rules));
});
