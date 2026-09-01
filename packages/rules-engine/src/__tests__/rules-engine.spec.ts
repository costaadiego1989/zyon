import test from "node:test";
import assert from "node:assert/strict";
import {
  estimateMargin,
  evaluateDiscountOffer
} from "../index.js";
import type { Cart, MerchantRules } from "@zyon/shared-types";

// ============================================================================
// Test Fixtures
// ============================================================================

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

// ============================================================================
// Scenario 1: Margin Enforcement
// ============================================================================

test("Scenario 1.1: rejects discount violating minimum margin percent", () => {
  // Item: price 100, cost 30
  // maxDiscountPercent = 50 (high, so cap doesn't interfere)
  // minimumMarginPercent = 60% → discount must leave margin ≥ 60%
  // Discount 30% → subsidy 30, grossRevenue=70, fees=2.8, margin=(70-30-2.8)/70=53.1% ✗
  const cart: Cart = makeCart({
    total: 100,
    items: [{ sku: "A", name: "A", price: 100, cost: 30, quantity: 1 }]
  });

  const result = evaluateDiscountOffer(
    cart,
    { ...baseRules, maxDiscountPercent: 50, minimumMarginPercent: 60 },
    30 // 30% discount requested
  );

  assert.equal(result.approved, false, "Discount should be rejected");
  assert.equal(result.reason, "minimum_margin_violation");
  assert(result.marginAfterOffer < 0.60, "Margin after discount < 60%");
});

test("Scenario 1.2: approves discount respecting minimum margin", () => {
  // Item: price 100, cost 30
  // maxDiscountPercent = 50 (high, so cap doesn't interfere)
  // minimumMarginPercent = 60%
  // Discount 5% → subsidy 5, grossRevenue=95, fees=3.8, margin=(95-30-3.8)/95=64.4% ✓
  const cart: Cart = makeCart({
    total: 100,
    items: [{ sku: "A", name: "A", price: 100, cost: 30, quantity: 1 }]
  });

  const result = evaluateDiscountOffer(
    cart,
    { ...baseRules, maxDiscountPercent: 50, minimumMarginPercent: 60 },
    5
  );

  assert.equal(result.approved, true);
  assert.equal(result.type, "discount_percent");
  assert.equal(result.value, 5);
  assert(result.marginAfterOffer >= 0.60);
});

test("Scenario 1.3: margin calculation includes payment fees (4%)", () => {
  // Cart total 100, cost 50
  // grossRevenue = 100
  // paymentFees = 100 * 0.04 = 4
  // margin = (100 - 50 - 4) / 100 = 46%
  const cart: Cart = makeCart({ total: 100, items: [{ sku: "A", name: "A", price: 100, cost: 50, quantity: 1 }] });

  const margin = estimateMargin(cart, 0, 0.04);

  assert.equal(margin.paymentFees, 4, "Payment fees = 4%");
  assert.equal(margin.marginValue, 46, "Margin value = 100 - 50 - 4");
  assert.equal(margin.marginPercent, 0.46);
});

test("Scenario 1.4: margin with subsidy (discount) applied", () => {
  // Cart total 100, cost 50, discount 10% (subsidy 10)
  // grossRevenue = 100 - 10 = 90
  // paymentFees = 90 * 0.04 = 3.6
  // margin = (90 - 50 - 3.6) / 90 = 40.44%
  const cart: Cart = makeCart({ total: 100, items: [{ sku: "A", name: "A", price: 100, cost: 50, quantity: 1 }] });

  const margin = estimateMargin(cart, 10, 0.04);

  assert.equal(margin.grossRevenue, 90);
  assert.equal(margin.paymentFees, 3.6);
  assert.ok(Math.abs(margin.marginPercent - 0.4044) < 0.001);
});

// ============================================================================
// Scenario 2: MaxDiscountPercent Cap
// ============================================================================

test("Scenario 2.1: caps discount at merchant maxDiscountPercent even if margin allows more", () => {
  // Item: price 100, cost 20
  // 20% discount leaves 80, margin (80-20)/80 = 75% >> 38% minimum
  // But merchant maxDiscountPercent = 10% → cap at 10%
  const cart: Cart = makeCart({
    total: 100,
    items: [{ sku: "A", name: "A", price: 100, cost: 20, quantity: 1 }]
  });

  const result = evaluateDiscountOffer(
    cart,
    { ...baseRules, maxDiscountPercent: 10 },
    20
  );

  assert.equal(result.approved, true);
  assert.equal(result.value, 10, "Discount should be capped at merchant maximum");
  assert.equal(result.reason, "capped_by_max_discount_rule");
});

test("Scenario 2.2: max discount percent is hard ceiling, no exceptions", () => {
  // Even with zero minimum margin requirement
  const cart: Cart = makeCart({ total: 100, items: [{ sku: "A", name: "A", price: 100, cost: 20, quantity: 1 }] });

  const result = evaluateDiscountOffer(
    cart,
    { ...baseRules, maxDiscountPercent: 5, minimumMarginPercent: 1 },
    50 // Request 50%, but merchant max is 5%
  );

  assert.equal(result.value, 5, "Should cap at 5% regardless of request");
});

// ============================================================================
// Scenario 3: Cost Fallback (50% if Missing)
// ============================================================================

test("Scenario 3.1: uses explicit cost when provided (no defaulting)", () => {
  const cart: Cart = makeCart();
  // items: [{ price:100, cost:50, qty:2 }] → cost = 50*2 = 100
  const margin = estimateMargin(cart);

  assert.equal(margin.productCost, 100);
  assert.equal(margin.grossRevenue, 200);
});

test("Scenario 3.2: defaults to 50% of price when cost is undefined", () => {
  // Item: price 100, NO cost field → defaults to 50
  const cart: Cart = makeCart({
    total: 100,
    items: [{ sku: "A", name: "A", price: 100, quantity: 1 }] // No cost
  });

  const margin = estimateMargin(cart);

  assert.equal(margin.productCost, 50, "Cost should default to 50% of price");
  assert.equal(margin.marginValue, 100 - 50 - 4, "Margin = 100 - 50 - 4");
});

test("Scenario 3.3: approval with defaulted cost", () => {
  // Cart: 100 total, cost defaults to 50
  // minimum margin 30% → (100 - subsidy - 50 - 4) / (100 - subsidy) ≥ 30%
  // Discount 20% (subsidy 20) → (80 - 50 - 3.2) / 80 = 40.6% ✓
  const cart: Cart = makeCart({
    total: 100,
    items: [{ sku: "A", name: "A", price: 100, quantity: 1 }]
  });

  const result = evaluateDiscountOffer(
    cart,
    { ...baseRules, minimumMarginPercent: 30, maxDiscountPercent: 100 },
    20
  );

  assert.equal(result.approved, true);
  assert(result.marginAfterOffer > 0.30);
});

// ============================================================================
// Scenario 4: Zero and Edge Cases
// ============================================================================

test("Scenario 4.1: zero discount returns denial with discount_not_requested", () => {
  const cart: Cart = makeCart();

  const result = evaluateDiscountOffer(cart, baseRules, 0);

  assert.equal(result.approved, false);
  assert.equal(result.reason, "discount_not_requested");
  assert.equal(result.type, "none");
  assert.equal(result.value, 0);
});

test("Scenario 4.2: negative discount capped to 0", () => {
  const cart: Cart = makeCart();

  const result = evaluateDiscountOffer(cart, baseRules, -5);

  assert.equal(result.approved, false);
  assert.equal(result.reason, "discount_not_requested");
});

test("Scenario 4.3: 100% discount reduces margin to 0", () => {
  const cart: Cart = makeCart({ total: 100, items: [{ sku: "A", name: "A", price: 100, cost: 50, quantity: 1 }] });

  const margin = estimateMargin(cart, 100, 0.04);

  assert.equal(margin.grossRevenue, 0, "100% subsidy → no revenue");
  assert.equal(margin.marginPercent, 0);
});

test("Scenario 4.4: multi-item cart margin aggregates all costs", () => {
  const cart: Cart = {
    currency: "BRL",
    total: 300,
    items: [
      { sku: "A", name: "A", price: 100, cost: 30, quantity: 1 },
      { sku: "B", name: "B", price: 100, cost: 40, quantity: 1 },
      { sku: "C", name: "C", price: 100, cost: 50, quantity: 1 }
    ]
  };

  const margin = estimateMargin(cart);

  assert.equal(margin.productCost, 120, "30 + 40 + 50");
  assert.equal(margin.grossRevenue, 300);
});

// ============================================================================
// Scenario 5: Approval vs Capping vs Rejection
// ============================================================================

test("Scenario 5.1: approved and NOT capped (requested ≤ max, margin OK)", () => {
  const cart: Cart = makeCart({ total: 100, items: [{ sku: "A", name: "A", price: 100, cost: 40, quantity: 1 }] });

  const result = evaluateDiscountOffer(
    cart,
    { ...baseRules, maxDiscountPercent: 15, minimumMarginPercent: 40 },
    10
  );

  assert.equal(result.approved, true);
  assert.equal(result.value, 10);
  assert.equal(result.reason, "discount_allowed");
});

test("Scenario 5.2: approved but capped (requested > max, margin OK with capped value)", () => {
  const cart: Cart = makeCart({ total: 100, items: [{ sku: "A", name: "A", price: 100, cost: 40, quantity: 1 }] });

  const result = evaluateDiscountOffer(
    cart,
    { ...baseRules, maxDiscountPercent: 10, minimumMarginPercent: 35 },
    15 // Request 15%, max is 10%
  );

  assert.equal(result.approved, true);
  assert.equal(result.value, 10, "Capped at max");
  assert.equal(result.reason, "capped_by_max_discount_rule");
});

test("Scenario 5.3: rejected (margin violation even with capped value)", () => {
  const cart: Cart = makeCart({ total: 100, items: [{ sku: "A", name: "A", price: 100, cost: 80, quantity: 1 }] });

  // Even at 10% discount, margin = (90 - 80 - 3.6) / 90 = 6.4% << 30%
  const result = evaluateDiscountOffer(
    cart,
    { ...baseRules, maxDiscountPercent: 10, minimumMarginPercent: 30 },
    5
  );

  assert.equal(result.approved, false);
  assert.equal(result.reason, "minimum_margin_violation");
});

// ============================================================================
// Scenario 6: Payment Fee Rate
// ============================================================================

test("Scenario 6.1: payment fee = 4% by default", () => {
  const cart: Cart = makeCart({ total: 100, items: [{ sku: "A", name: "A", price: 100, cost: 50, quantity: 1 }] });

  const margin = estimateMargin(cart, 0);

  assert.equal(margin.paymentFees, 4, "4% of 100 = 4");
});

test("Scenario 6.2: payment fee respects custom rate", () => {
  const cart: Cart = makeCart({ total: 100, items: [{ sku: "A", name: "A", price: 100, cost: 50, quantity: 1 }] });

  const margin = estimateMargin(cart, 0, 0.06); // 6% rate

  assert.equal(margin.paymentFees, 6);
});

// ============================================================================
// Scenario 7: Margin Calculation Formula
// ============================================================================

test("Scenario 7.1: margin formula = (grossRevenue - cost - fees) / grossRevenue", () => {
  // Verify the exact formula is correct
  const cart: Cart = makeCart({
    total: 500,
    items: [{ sku: "A", name: "A", price: 500, cost: 200, quantity: 1 }]
  });

  const result = estimateMargin(cart, 50, 0.04); // subsidy 50, fee 4%

  const expectedGrossRevenue = 450;
  const expectedPaymentFees = 18;
  const expectedMarginValue = 450 - 200 - 18;
  const expectedMarginPercent = expectedMarginValue / expectedGrossRevenue;

  assert.equal(result.grossRevenue, expectedGrossRevenue);
  assert.equal(result.paymentFees, expectedPaymentFees);
  assert.equal(result.marginValue, expectedMarginValue);
  assert.equal(result.marginPercent, expectedMarginPercent);
});

// ============================================================================
// Scenario 8: Subsidy Bounds
// ============================================================================

test("Scenario 8.1: subsidy cannot reduce grossRevenue below 0", () => {
  const cart: Cart = makeCart({ total: 100, items: [{ sku: "A", name: "A", price: 100, cost: 50, quantity: 1 }] });

  // Subsidy of 150 would make grossRevenue -50
  const result = estimateMargin(cart, 150, 0.04);

  assert.equal(result.grossRevenue, 0, "Subsidy capped at cart total");
});

test("Scenario 8.2: marginValue is negative when cost > grossRevenue", () => {
  const cart: Cart = makeCart({ total: 50, items: [{ sku: "A", name: "A", price: 50, cost: 80, quantity: 1 }] });

  const result = estimateMargin(cart, 0, 0.04);

  assert(result.marginValue < 0, "Margin should be negative when cost exceeds revenue");
});
