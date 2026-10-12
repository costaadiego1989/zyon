import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MERCHANT_RULES, type Cart } from "@zyon/shared-types";
import { assessIncentiveMargin, calculateContribution, estimateMargin, evaluateDiscountOffer } from "./index.js";

const cart: Cart = { currency: "BRL", total: 200, items: [{ sku: "a", name: "A", price: 100, cost: 50, quantity: 2 }] };
const rules = { ...DEFAULT_MERCHANT_RULES };

test("known costs, quantities and fees reconcile in cents after the discount", () => {
  assert.deepEqual(estimateMargin(cart, 20), {
    grossRevenue: 180, productCost: 100, paymentFees: 7.2, subsidy: 20,
    marginValue: 72.8, marginPercent: 7280 / 18000,
    status: "estimated", reason: "known_cost_fee_assumption",
  });
  assert.equal(estimateMargin(cart, 0, 0.07).paymentFees, 14);
});

test("missing or partially missing costs are unavailable, even with a zero margin floor", () => {
  for (const items of [[], [{ ...cart.items[0], cost: undefined }],
    [{ ...cart.items[0], quantity: 1 }, { ...cart.items[0], quantity: 1, cost: undefined }]]) {
    const unknown = { ...cart, items };
    assert.equal(estimateMargin(unknown).productCost, null);
    assert.equal(estimateMargin(unknown).marginPercent, null);
    assert.equal(evaluateDiscountOffer(unknown, { ...rules, minimumMarginPercent: 0 }, 10).reason, "product_cost_missing");
  }
});

test("a catalog base cost does not cover unpriced add-ons", () => {
  const options = { ...cart, items: [{ ...cart.items[0], selected_options: [{ group_name: "Extra", item_name: "Extra", price_modifier: 10 }] }] };
  assert.equal(evaluateDiscountOffer(options, rules, 5).reason, "product_option_cost_missing");
});

test("explicit zero cost is valid, zero net revenue cannot authorize a margin", () => {
  const freeCost = { ...cart, items: [{ ...cart.items[0], cost: 0 }] };
  assert.equal(evaluateDiscountOffer(freeCost, rules, 5).approved, true);
  assert.equal(evaluateDiscountOffer(freeCost, { ...rules, maxDiscountPercent: 100, minimumMarginPercent: 0 }, 100).approved, false);
});

test("discounts above revenue, empty carts and mismatched totals fail closed", () => {
  assert.equal(estimateMargin(cart, 201).status, "unavailable");
  assert.equal(evaluateDiscountOffer({ ...cart, total: 500 }, rules, 10).reason, "cart_total_mismatch");
  assert.equal(evaluateDiscountOffer({ ...cart, total: 0, items: [] }, rules, 10).approved, false);
});

test("caps apply before margin, never bypassing the configured floor", () => {
  const capped = evaluateDiscountOffer(cart, rules, 50);
  assert.equal(capped.approved, true);
  assert.equal(capped.value, 10);
  assert.equal(capped.reason, "capped_by_max_discount_rule");
  assert.equal(evaluateDiscountOffer(cart, { ...rules, minimumMarginPercent: 50 }, 50).reason, "minimum_margin_violation");
  assert.equal(evaluateDiscountOffer(cart, rules, 10, 5).value, 2.5);
  assert.equal(evaluateDiscountOffer(cart, rules, 10, 5).reason, "capped_by_reais_limit");
});

test("one cent boundary: accept equality and reject the next cent of product cost", () => {
  const boundary: Cart = { currency: "BRL", total: 100, items: [{ sku: "b", name: "B", price: 100, cost: 52.2, quantity: 1 }] };
  assert.equal(evaluateDiscountOffer(boundary, rules, 10).approved, true); // 90 - 52.20 - 3.60 = 34.20 (38%)
  assert.equal(evaluateDiscountOffer({ ...boundary, items: [{ ...boundary.items[0], cost: 52.21 }] }, rules, 10).approved, false);
});

test("existing discount participates once and cannot exceed the current policy", () => {
  assert.equal(evaluateDiscountOffer({ ...cart, currentDiscount: 20 }, rules, 5).marginAfterOffer, 7280 / 18000);
  assert.equal(evaluateDiscountOffer({ ...cart, currentDiscount: 21 }, rules, 5).reason, "existing_discount_above_limit");
});

test("tiny amounts do not round benefits up through percentage caps", () => {
  const tiny: Cart = { currency: "BRL", total: 1.01, items: [{ sku: "a", name: "a", price: 1.01, cost: 0, quantity: 1 }] };
  const offer = evaluateDiscountOffer(tiny, rules, 10);
  assert.equal(Math.round(tiny.total * offer.value), 10);
  assert.ok(offer.value <= 10);
  assert.equal(estimateMargin(tiny).paymentFees, 0.05);
});

test("malformed numbers, currencies and policies never approve", () => {
  for (const bad of [NaN, Infinity, -1, 0.001]) {
    assert.equal(evaluateDiscountOffer({ ...cart, items: [{ ...cart.items[0], cost: bad }] }, rules, 5).approved, false);
  }
  for (const bad of [NaN, Infinity]) assert.equal(evaluateDiscountOffer(cart, rules, bad).approved, false);
  for (const bad of [-1, NaN, Infinity, 101]) {
    assert.equal(evaluateDiscountOffer(cart, { ...rules, minimumMarginPercent: bad }, 5).approved, false);
    assert.equal(evaluateDiscountOffer(cart, { ...rules, maxDiscountPercent: bad }, 5).approved, false);
  }
  assert.equal(evaluateDiscountOffer({ ...cart, currency: "USD" }, rules, 5).reason, "incentive_currency_unsupported");
  for (const value of [0, -1]) assert.equal(evaluateDiscountOffer(cart, rules, value).approved, false);
});

test("shipping carrier cost is an expense, shipping charged to the buyer is revenue", () => {
  const margin = assessIncentiveMargin(cart, { totalDiscount: 20, shippingRevenue: 5, shippingCost: 30 });
  assert.equal(margin.revenueCents, 18500);
  assert.equal(margin.paymentFeesCents, 740);
  assert.equal(margin.marginCents, 4760);
});

test("contribution uses net receipts once and includes all known components", () => {
  const result = calculateContribution({ currency: "BRL", netReceiptsCents: 9000,
    productCostCents: 4000, paymentFeesCents: 400, taxCents: 200, shippingCostCents: 800,
    commissionCents: 100, communicationCostCents: 20, aiCostCents: 30 });
  assert.equal(result.contributionCents, 3450);
  assert.equal(result.status, "complete");
  assert.deepEqual(result.missingComponents, []);
});

test("contribution preserves absence, measured zero, losses and invalid data", () => {
  const input = { currency: "BRL", netReceiptsCents: 100, productCostCents: 200,
    paymentFeesCents: 0, taxCents: 0, shippingCostCents: 0, commissionCents: 0, communicationCostCents: 0, aiCostCents: 0 };
  assert.equal(calculateContribution(input).contributionCents, -100);
  const missing = calculateContribution({ ...input, aiCostCents: null });
  assert.equal(missing.contributionCents, null);
  assert.deepEqual(missing.missingComponents, ["aiCostCents"]);
  assert.equal(calculateContribution({ ...input, paymentFeesCents: 0.5 }).status, "unavailable");
  assert.equal(calculateContribution({ ...input, taxCents: Number.MAX_SAFE_INTEGER, productCostCents: Number.MAX_SAFE_INTEGER }).status, "unavailable");
});
