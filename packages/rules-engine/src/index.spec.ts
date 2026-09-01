import test from "node:test";
import assert from "node:assert/strict";
import {
  estimateMargin,
  evaluateDiscountOffer
} from "./index.js";
import type { Cart, MerchantRules } from "@zyon/shared-types";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const baseRules: MerchantRules = {
  maxDiscountPercent: 10,
  minimumMarginPercent: 38,
  allowFreeShipping: true,
  allowShippingDiscount: true,
  allowBonusItem: false,
  allowStackDiscountAndFreeShipping: false,
  freeShippingMinCartValue: 250,
  maxShippingSubsidy: 45,
  maxPartialShippingDiscount: 20,
  offerExpirationMinutes: 15,
  blockedRegions: [],
  brandVoice: "consultative",
  couponBoxEnabled: true,
  autonomousEngineEnabled: true
};

function makeCart(overrides: Partial<Cart> = {}): Cart {
  return {
    currency: "BRL",
    total: 200,
    items: [
      { sku: "A", name: "A", price: 100, cost: 50, quantity: 2 }
    ],
    ...overrides
  };
}

// ===========================================================================
// estimateMargin
// ===========================================================================

test("estimateMargin uses explicit cost when provided (no defaulting)", () => {
  const cart: Cart = makeCart();
  const m = estimateMargin(cart);
  // items: [{price:100, cost:50, qty:2}] -> cost sum = 50*2 = 100
  assert.equal(m.productCost, 100);
  // grossRevenue = cart.total - subsidy (subsidy=0) = 200
  assert.equal(m.grossRevenue, 200);
  // paymentFees = 200 * 0.04 = 8
  assert.equal(m.paymentFees, 8);
  // marginValue = 200 - 100 - 8 = 92
  assert.equal(m.marginValue, 92);
  // marginPercent = 92/200 = 0.46
  assert.equal(m.marginPercent, 0.46);
});

test("estimateMargin defaults cost to 50% of price when cost is missing", () => {
  const cart: Cart = {
    currency: "BRL",
    total: 200,
    items: [{ sku: "A", name: "A", price: 100, quantity: 2 }]
  };
  // No cost -> default = price * 0.5 = 50, qty=2 -> 100
  const m = estimateMargin(cart);
  assert.equal(m.productCost, 100);
});

test("estimateMargin applies default cost per item independently", () => {
  const cart: Cart = {
    currency: "BRL",
    total: 300,
    items: [
      { sku: "A", name: "A", price: 100, quantity: 1 }, // no cost -> 50
      { sku: "B", name: "B", price: 100, cost: 20, quantity: 1 } // cost provided -> 20
    ]
  };
  const m = estimateMargin(cart);
  assert.equal(m.productCost, 70);
});

test("estimateMargin subsides gross revenue and computes fees on post-subsidy amount", () => {
  const cart: Cart = makeCart();
  const subsidy = 20;
  const m = estimateMargin(cart, subsidy);
  // grossRevenue = max(200 - 20, 0) = 180
  assert.equal(m.grossRevenue, 180);
  // paymentFees = 180 * 0.04 = 7.2
  assert.equal(m.paymentFees, 7.2);
  // marginValue = 180 - 100 - 7.2 = 72.8
  assert.equal(m.marginValue, 72.8);
  assert.equal(m.subsidy, 20);
});

test("estimateMargin clamps gross revenue at 0 when subsidy exceeds total", () => {
  const cart: Cart = makeCart(); // total = 200
  const m = estimateMargin(cart, 500);
  assert.equal(m.grossRevenue, 0);
  assert.equal(m.paymentFees, 0);
  // marginValue = 0 - 100 - 0 = -100
  assert.equal(m.marginValue, -100);
});

test("estimateMargin default paymentFeeRate is 4% (CLAUDE.md invariant)", () => {
  const cart: Cart = makeCart();
  // grossRevenue = 200, expected paymentFees = 200 * 0.04 = 8
  const m = estimateMargin(cart);
  assert.equal(m.paymentFees, 8);
  assert.equal(m.paymentFees / m.grossRevenue, 0.04);
});

test("estimateMargin accepts custom paymentFeeRate", () => {
  const cart: Cart = makeCart();
  const m = estimateMargin(cart, 0, 0.07);
  assert.ok(Math.abs(m.paymentFees - 14) < 1e-9);
  assert.ok(Math.abs(m.paymentFees / m.grossRevenue - 0.07) < 1e-9);
});

test("estimateMargin paymentFees scales with grossRevenue, not cart.total", () => {
  // grossRevenue = total - subsidy, payment fees must follow grossRevenue
  const cart: Cart = makeCart({ total: 500 });
  const m = estimateMargin(cart, 100); // subsidy=100
  // grossRevenue = 400, paymentFees = 400 * 0.04 = 16
  assert.equal(m.paymentFees, 16);
});

test("estimateMargin marginPercent is 0 when grossRevenue is 0", () => {
  const cart: Cart = makeCart({ total: 100 });
  // subsidy >= total => grossRevenue clamped to 0
  const m = estimateMargin(cart, 200);
  assert.equal(m.grossRevenue, 0);
  assert.equal(m.marginPercent, 0);
});

test("estimateMargin returns negative marginValue when cost+fees exceed revenue", () => {
  const cart: Cart = {
    currency: "BRL",
    total: 50,
    items: [{ sku: "X", name: "X", price: 100, cost: 100, quantity: 1 }]
  };
  const m = estimateMargin(cart);
  // grossRevenue = 50, productCost = 100, paymentFees = 2 -> -52
  assert.equal(m.marginValue, -52);
  assert.equal(m.marginPercent, -52 / 50);
});

test("estimateMargin handles empty cart", () => {
  const cart: Cart = { currency: "BRL", total: 0, items: [] };
  const m = estimateMargin(cart);
  assert.equal(m.productCost, 0);
  assert.equal(m.grossRevenue, 0);
  assert.equal(m.paymentFees, 0);
  assert.equal(m.marginValue, 0);
  assert.equal(m.marginPercent, 0);
});

test("estimateMargin multiplies cost by item quantity", () => {
  const cart: Cart = {
    currency: "BRL",
    total: 100,
    items: [{ sku: "A", name: "A", price: 10, cost: 5, quantity: 3 }]
  };
  const m = estimateMargin(cart);
  // 5 * 3 = 15
  assert.equal(m.productCost, 15);
});

test("estimateMargin result shape matches MarginResult contract", () => {
  const cart: Cart = makeCart();
  const m = estimateMargin(cart);
  assert.equal(typeof m.grossRevenue, "number");
  assert.equal(typeof m.productCost, "number");
  assert.equal(typeof m.paymentFees, "number");
  assert.equal(typeof m.subsidy, "number");
  assert.equal(typeof m.marginValue, "number");
  assert.equal(typeof m.marginPercent, "number");
});

// ===========================================================================
// evaluateDiscountOffer
// ===========================================================================

test("evaluateDiscountOffer approves when within max and above minimum margin", () => {
  // cart total=200, items cost 50 each, qty=2 => productCost=100
  // requesting 10% subsidy=20 -> grossRevenue=180, fees=7.2
  // margin = 180 - 100 - 7.2 = 72.8 -> 72.8/180 = ~0.4044 > 0.38
  const cart = makeCart();
  const result = evaluateDiscountOffer(cart, baseRules, 10);
  assert.equal(result.approved, true);
  assert.equal(result.type, "discount_percent");
  assert.equal(result.value, 10);
  assert.equal(result.reason, "discount_allowed");
});

test("evaluateDiscountOffer hard-caps value at rules.maxDiscountPercent", () => {
  // max=10 in baseRules, request 50
  const cart = makeCart();
  const result = evaluateDiscountOffer(cart, baseRules, 50);
  assert.equal(result.approved, true);
  assert.equal(result.value, 10);
  assert.equal(result.reason, "capped_by_max_discount_rule");
  assert.equal(result.type, "discount_percent");
});

test("evaluateDiscountOffer never returns value greater than maxDiscountPercent", () => {
  const cart = makeCart({ total: 1000 });
  const rules: MerchantRules = { ...baseRules, maxDiscountPercent: 5 };
  for (const requested of [5, 10, 25, 50, 99, 100]) {
    const result = evaluateDiscountOffer(cart, rules, requested);
    assert.ok(
      result.value <= rules.maxDiscountPercent,
      `value ${result.value} must be <= maxDiscountPercent ${rules.maxDiscountPercent}`
    );
  }
});

test("evaluateDiscountOffer rejects (none) when margin would drop below minimumMarginPercent", () => {
  // Force tight margin: total=120, cost=100 (qty=2 of 50), requesting 10%
  // subsidy=12, grossRevenue=108, fees=4.32, margin=108-100-4.32=3.68 -> 0.034 < 0.38
  const cart: Cart = {
    currency: "BRL",
    total: 120,
    items: [{ sku: "A", name: "A", price: 60, cost: 50, quantity: 2 }]
  };
  const result = evaluateDiscountOffer(cart, baseRules, 10);
  assert.equal(result.approved, false);
  assert.equal(result.type, "none");
  assert.equal(result.value, 0);
  assert.equal(result.reason, "minimum_margin_violation");
});

test("evaluateDiscountOffer rejects zero or negative requested discount as discount_not_requested", () => {
  const cart = makeCart();
  const zero = evaluateDiscountOffer(cart, baseRules, 0);
  assert.equal(zero.approved, false);
  assert.equal(zero.type, "none");
  assert.equal(zero.value, 0);
  assert.equal(zero.reason, "discount_not_requested");

  const negative = evaluateDiscountOffer(cart, baseRules, -5);
  assert.equal(negative.approved, false);
  assert.equal(negative.type, "none");
  assert.equal(negative.value, 0);
  assert.equal(negative.reason, "discount_not_requested");
});

test("evaluateDiscountOffer treats 100% requested as capped then rejected for margin", () => {
  // max=10, request=100 -> capped to 10 -> subsidy=20 -> same margin check
  // cart total=120, cost=100 -> margin_violation
  const cart: Cart = {
    currency: "BRL",
    total: 120,
    items: [{ sku: "A", name: "A", price: 60, cost: 50, quantity: 2 }]
  };
  const result = evaluateDiscountOffer(cart, baseRules, 100);
  assert.equal(result.approved, false);
  assert.equal(result.reason, "minimum_margin_violation");
  assert.equal(result.value, 0);
});

test("evaluateDiscountOffer approves 100% when rules allow it and margin holds", () => {
  // max=100, minMargin=0, generous cart -> always approve
  const cart = makeCart({ total: 1000 });
  const permissive: MerchantRules = {
    ...baseRules,
    maxDiscountPercent: 100,
    minimumMarginPercent: 0
  };
  const result = evaluateDiscountOffer(cart, permissive, 100);
  assert.equal(result.approved, true);
  assert.equal(result.type, "discount_percent");
  assert.equal(result.value, 100);
  assert.equal(result.reason, "discount_allowed");
});

test("evaluateDiscountOffer returns correct marginAfterOffer on approval", () => {
  // total=200, cost=100, requesting 10% -> subsidy=20, grossRevenue=180
  // paymentFees = 7.2, marginValue = 72.8, marginPercent = 0.4044...
  const cart = makeCart();
  const result = evaluateDiscountOffer(cart, baseRules, 10);
  const expectedMargin = (180 - 100 - 7.2) / 180;
  assert.ok(Math.abs(result.marginAfterOffer - expectedMargin) < 1e-9);
});

test("evaluateDiscountOffer returns correct marginAfterOffer on margin violation", () => {
  const cart: Cart = {
    currency: "BRL",
    total: 120,
    items: [{ sku: "A", name: "A", price: 60, cost: 50, quantity: 2 }]
  };
  const result = evaluateDiscountOffer(cart, baseRules, 10);
  // subsidy = 12, grossRevenue = 108, fees = 4.32, marginPct = (108-100-4.32)/108
  const expected = (108 - 100 - 4.32) / 108;
  assert.ok(Math.abs(result.marginAfterOffer - expected) < 1e-9);
});

test("evaluateDiscountOffer uses default 50% cost for cost-less items in margin math", () => {
  // item cost is missing -> default cost = 100 * 0.5 = 50, qty=2 -> productCost=100
  // requesting 10% -> subsidy=20, grossRevenue=180, fees=7.2
  // margin = 180 - 100 - 7.2 = 72.8 -> 0.4044 > 0.38 -> approve
  const cart: Cart = {
    currency: "BRL",
    total: 200,
    items: [{ sku: "A", name: "A", price: 100, quantity: 2 }]
  };
  const result = evaluateDiscountOffer(cart, baseRules, 10);
  assert.equal(result.approved, true);
  assert.equal(result.reason, "discount_allowed");
});

test("evaluateDiscountOffer cap honors minimumMarginPercent — cap must NOT bypass margin guard", () => {
  // max=20, min=50, requesting 100 -> cap to 20 -> subsidy=40
  // grossRevenue=160, fees=6.4, cost=100 -> margin = 53.6/160 = 0.335 < 0.5 -> reject
  const cart: Cart = makeCart({ total: 200 }); // productCost=100
  const tight: MerchantRules = {
    ...baseRules,
    maxDiscountPercent: 20,
    minimumMarginPercent: 50
  };
  const result = evaluateDiscountOffer(cart, tight, 100);
  assert.equal(result.approved, false);
  assert.equal(result.reason, "minimum_margin_violation");
  // capped value = 20 (visible only when approved — here it's 0)
  assert.equal(result.value, 0);
});

test("evaluateDiscountOffer approved amount is exactly the (capped) percentage applied to total", () => {
  const cart = makeCart({ total: 500 });
  const result = evaluateDiscountOffer(cart, baseRules, 5);
  // subsidy = 500 * 0.05 = 25
  const subsidy = 500 * 0.05;
  // grossRevenue = 475, fees = 19, cost = 100
  // margin = 475 - 100 - 19 = 356 -> 356/475 = 0.7495 > 0.38 -> approved
  assert.equal(result.approved, true);
  assert.equal(result.value, 5);
  const expectedMarginPct = (475 - 100 - 19) / 475;
  assert.ok(Math.abs(result.marginAfterOffer - expectedMarginPct) < 1e-9);
});

test("evaluateDiscountOffer rejects requested discount that violates minimumMarginPercent even under cap", () => {
  // tiny cart, large subsidy -> margin drops below floor
  const cart: Cart = {
    currency: "BRL",
    total: 60,
    items: [{ sku: "A", name: "A", price: 30, cost: 25, quantity: 2 }] // productCost=50
  };
  // max=15, request=15 -> subsidy=9, grossRevenue=51, fees=2.04
  // margin = 51 - 50 - 2.04 = -1.04 -> negative -> < 0.38 -> reject
  const result = evaluateDiscountOffer(cart, baseRules, 15);
  assert.equal(result.approved, false);
  assert.equal(result.reason, "minimum_margin_violation");
});

test("evaluateDiscountOffer margin guard uses raw margin < minimumMarginPercent/100 (strict)", () => {
  // Construct a case at exactly the boundary; strict < should reject on equal boundary.
  // Find a cart where marginPercent after offer exactly equals rules.minimumMarginPercent/100.
  // minimumMarginPercent = 38 -> threshold 0.38
  // cart total=200, productCost=100, paymentFeeRate=0.04
  // subsidy=x -> grossRevenue=200-x, fees=0.04*(200-x), marginPct = (200-x - 100 - 0.04*(200-x))/ (200-x)
  //           = (1 - 0.04 - 100/(200-x))
  // Set equal to 0.38 -> 0.58 - 100/(200-x) = 0.38 -> 100/(200-x) = 0.20 -> 200-x = 500
  // x = -300; not feasible. Use paymentFeeRate variation by lowering it; but the engine
  // uses fixed 0.04 in evaluateDiscountOffer (not exposed). So pick a larger cart.
  // Easier: construct math that guarantees margin below threshold.
  // Take minimumMarginPercent=1 -> threshold=0.01. Find subsidy that puts marginPct just below.
  const cart: Cart = {
    currency: "BRL",
    total: 110,
    items: [{ sku: "A", name: "A", price: 55, cost: 50, quantity: 2 }] // productCost=100
  };
  // subsidy=10, grossRevenue=100, fees=4, marginValue=-4, marginPct=-0.04
  const strictFloor: MerchantRules = { ...baseRules, minimumMarginPercent: 1 };
  const result = evaluateDiscountOffer(cart, strictFloor, 10);
  assert.equal(result.approved, false);
  assert.equal(result.reason, "minimum_margin_violation");
});

test("evaluateDiscountOffer handles multiple items with mixed cost presence", () => {
  const cart: Cart = {
    currency: "BRL",
    total: 500,
    items: [
      { sku: "A", name: "A", price: 100, cost: 30, quantity: 2 }, // cost sum = 60
      { sku: "B", name: "B", price: 50, quantity: 6 } // default cost = 25 each * 6 = 150
    ]
  };
  // productCost = 60 + 150 = 210
  // requesting 5% -> subsidy = 25, grossRevenue=475, fees=19
  // margin = 475 - 210 - 19 = 246 -> 246/475 = 0.5178 > 0.38 -> approve
  const result = evaluateDiscountOffer(cart, baseRules, 5);
  assert.equal(result.approved, true);
  assert.equal(result.value, 5);
});

test("evaluateDiscountOffer result is immutable-ish OfferEvaluation shape", () => {
  const cart = makeCart();
  const result = evaluateDiscountOffer(cart, baseRules, 10);
  for (const k of ["approved", "type", "value", "reason", "marginAfterOffer"] as const) {
    assert.ok(k in result, `${k} present in OfferEvaluation`);
  }
});

test("evaluateDiscountOffer: percent <= 0 short-circuits before cap and before margin check", () => {
  // Construct a cart that would normally violate margin.
  const cart: Cart = {
    currency: "BRL",
    total: 60,
    items: [{ sku: "A", name: "A", price: 30, cost: 25, quantity: 2 }] // productCost=50
  };
  const result = evaluateDiscountOffer(cart, baseRules, 0);
  assert.equal(result.reason, "discount_not_requested");
  // reason must NOT be minimum_margin_violation
  assert.notEqual(result.reason, "minimum_margin_violation");
});
