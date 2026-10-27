import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MERCHANT_RULES } from "@zyon/shared-types";
import { incentivePolicySnapshot } from "./incentive-policy.js";
import { deriveProposedIncentivePolicy, assertProposedIncentivePolicy } from "./incentive-policy-proposal.js";
import { plannerDiscountStudy } from "./strategy-discount-study.js";
import { revenueIncentiveOptions, assertRevenueIncentiveOptions } from "./revenue-incentive-options.js";

const previous = incentivePolicySnapshot("store", 0, { enabled: false, limitCents: 0, maxDiscountCents: 0, maxRedemptions: 0 });
const asOf = "2026-10-05T00:00:00.000Z";
const baseline = { buyers: 10000, conversions: 10, complete: true, windowStart: "2026-08-31T00:00:00.000Z", windowEnd: "2026-09-28T00:00:00.000Z" };
const rules = { ...DEFAULT_MERCHANT_RULES, autonomousEngineEnabled: true, couponBoxEnabled: true,
  maxDiscountPercent: 10, minimumMarginPercent: 35, allowShippingDiscount: true, maxPartialShippingDiscount: 8, maxShippingSubsidy: 8 };
const study = () => plannerDiscountStudy({ merchantId: "store", runId: "run", observationId: "obs", asOf, capturedAt: asOf, rules,
  cohorts: [{ intent: "price_sensitive", sampleSize: 30, conversionRate: .1,
    carts: Array.from({ length: 30 }, () => ({ currency: "BRL", total: 100, items: [{ sku: "sku", name: "Produto", price: 100, cost: 40, quantity: 1 }] })),
    shipping: Array.from({ length: 30 }, () => ({ customerPrice: 20, realCost: 20 })) }] });

test("automatic exposure funds exactly the viable treatment sample and remains a proposal", () => {
  const proposed = deriveProposedIncentivePolicy(previous, baseline, asOf, 500)!;
  assert.ok(proposed); assert.equal(proposed.policy.version, 1);
  assert.ok(proposed.policy.maxRedemptions >= 100 && proposed.policy.maxRedemptions <= 1250);
  assert.equal(proposed.policy.limitCents, proposed.policy.maxDiscountCents * proposed.policy.maxRedemptions);
  assert.equal(previous.enabled, false); assert.equal(previous.version, 0);
  assert.equal(proposed.policyProposal.previousPolicyHash, previous.policyHash);
  assertProposedIncentivePolicy(proposed.policy, proposed.policyProposal, baseline, asOf);
});

for (const patch of [{ buyers: 99, conversions: 1 }, { buyers: 1000, conversions: 1 }, { conversions: 0 }, { conversions: 10000 },
  { complete: false }, { windowStart: "2026-09-01T00:00:00.000Z" }]) test("automatic proposal refuses incomplete or statistically infeasible history", () => {
  assert.equal(deriveProposedIncentivePolicy(previous, { ...baseline, ...patch }, asOf, 500), null);
});

test("automatic proposal refuses overflow and edits to the proposed spending envelope", () => {
  assert.equal(deriveProposedIncentivePolicy(previous, baseline, asOf, 2147483647), null);
  const proposed = deriveProposedIncentivePolicy(previous, baseline, asOf, 500)!;
  const altered = incentivePolicySnapshot("store", 1, { ...proposed.policy, maxRedemptions: proposed.policy.maxRedemptions + 1,
    limitCents: proposed.policy.limitCents + 500 });
  assert.throws(() => assertProposedIncentivePolicy(altered, proposed.policyProposal, baseline, asOf));
});

test("default automatic catalog offers only bounded feasible server candidates without editing merchant policy", () => {
  const source = study(), options = revenueIncentiveOptions(source, rules, { snapshot: previous, mode: "automatic" }, () => baseline);
  assert.equal(options.options.length, 4);
  assertRevenueIncentiveOptions(options, source, rules);
  for (const option of options.options) {
    assert.ok(option.recommendation.policyProposal);
    assert.equal(option.recommendation.approval, "separate_incentive_review_required");
    assert.equal(option.recommendation.budgetStatus, "not_reserved");
    assert.equal(option.recommendation.planning?.status, "estimated_feasible");
  }
  assert.equal(previous.enabled, false);
});

test("manual ceilings and explicit disable always take precedence over automatic proposal capacity", () => {
  const source = study();
  const manual = incentivePolicySnapshot("store", 1, { enabled: true, limitCents: 30000, maxDiscountCents: 1000, maxRedemptions: 30 });
  assert.equal(revenueIncentiveOptions(source, rules, { snapshot: manual, mode: "manual" }, () => baseline).options.length, 0);
  assert.equal(revenueIncentiveOptions(source, rules, { snapshot: manual, mode: "disabled" }, () => baseline).options.length, 0);
  assert.equal(revenueIncentiveOptions(source, rules, { snapshot: previous, mode: "automatic" }, () => ({ ...baseline, buyers: 40, conversions: 4 })).options.length, 0);
});

test("catalog rejects altered amounts, unknown fields and a foreign study before model selection", () => {
  const source = study(), catalog = revenueIncentiveOptions(source, rules, { snapshot: previous, mode: "automatic" }, () => baseline);
  for (const mutate of [(c: any) => c.options[0].recommendation.test.limitCents++, (c: any) => c.merchantId = "other",
    (c: any) => c.options[0].id = "f".repeat(64), (c: any) => c.allowSpend = true]) {
    const changed = structuredClone(catalog); mutate(changed);
    assert.throws(() => assertRevenueIncentiveOptions(changed, source, rules));
  }
});
