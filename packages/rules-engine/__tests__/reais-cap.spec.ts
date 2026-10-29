import test from "node:test";
import assert from "node:assert/strict";
import { evaluateDiscountOffer } from "../src/index.js";
import type { Cart, MerchantRules } from "@zyon/shared-types";

// ---------------------------------------------------------------------------
// RED spec — F0-T01: maxReaisCap (4th param of evaluateDiscountOffer)
// ADI-F0-02 / GA-01 (reais float). NOT YET IMPLEMENTED — must FAIL.
//
// Semantics under test (design.md F0):
//   percent         = min(requestedPercent, rules.maxDiscountPercent)
//   rawValue        = cart.total * percent / 100
//   effectiveValue  = maxReaisCap != null ? min(rawValue, maxReaisCap) : rawValue
//   effectivePercent = effectiveValue / cart.total * 100
//   subsidy (margin) = effectiveValue
//   returns value = effectivePercent, reason = "capped_by_reais_limit" when cap bit
//   guard: cart.total <= 0 -> value 0 (no crash)
// ---------------------------------------------------------------------------

// Rules with generous caps so margin never rejects the cap-focused cases.
const rules: MerchantRules = {
  maxDiscountPercent: 30,
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

// ===========================================================================
// Cap bites: 30% on R$100 cart, cap R$16 -> R$16 = 16%
// ===========================================================================
test("reais cap bites: 30% on R$100 cart with R$16 cap -> 16% (capped_by_reais_limit)", () => {
  // cart total=100, productCost=20 -> raw discount = 30 (30%), cap = 16 -> 16%
  // margin on subsidy=16: gross=84, fees=3.36, margin=(84-20-3.36)/84 ~= 0.722 > 0.38
  const cart: Cart = {
    currency: "BRL",
    total: 100,
    items: [{ sku: "A", name: "A", price: 100, cost: 20, quantity: 1 }]
  };
  const result = evaluateDiscountOffer(cart, rules, 30, 16);
  assert.equal(result.approved, true);
  assert.equal(result.type, "discount_percent");
  assert.equal(result.value, 16);
  assert.equal(result.reason, "capped_by_reais_limit");
});

// ===========================================================================
// Cap does NOT bite: 30% on R$40 cart -> raw R$12 < cap -> full 30%
// ===========================================================================
test("reais cap does not bite: 30% on R$40 cart -> R$12 = 30% (not capped)", () => {
  // raw = 40*0.30 = 12, cap high (say 50) so cap never bites -> value 30
  // margin: cost=8, subsidy=12, gross=28, fees=1.12, margin=(28-8-1.12)/28 ~= 0.674
  const cart: Cart = {
    currency: "BRL",
    total: 40,
    items: [{ sku: "A", name: "A", price: 40, cost: 8, quantity: 1 }]
  };
  const result = evaluateDiscountOffer(cart, rules, 30, 50);
  assert.equal(result.approved, true);
  assert.equal(result.type, "discount_percent");
  assert.equal(result.value, 30);
  assert.notEqual(result.reason, "capped_by_reais_limit");
});

// ===========================================================================
// Backward-compat: no cap -> pure percent behavior unchanged
// ===========================================================================
test("no reais cap (undefined 4th arg) -> pure percent, backward compatible", () => {
  const cart: Cart = {
    currency: "BRL",
    total: 100,
    items: [{ sku: "A", name: "A", price: 100, cost: 20, quantity: 1 }]
  };
  const result = evaluateDiscountOffer(cart, rules, 30);
  assert.equal(result.approved, true);
  assert.equal(result.type, "discount_percent");
  assert.equal(result.value, 30);
  assert.equal(result.reason, "discount_allowed");
});

// ===========================================================================
// Cap 0 -> effective discount 0 -> not approved (discount_not_requested)
// ===========================================================================
test("reais cap of 0 -> effective discount 0 (no discount authorized)", () => {
  const cart: Cart = {
    currency: "BRL",
    total: 100,
    items: [{ sku: "A", name: "A", price: 100, cost: 20, quantity: 1 }]
  };
  const result = evaluateDiscountOffer(cart, rules, 30, 0);
  assert.equal(result.approved, false);
  assert.equal(result.type, "none");
  assert.equal(result.value, 0);
});

// ===========================================================================
// Margin violation still rejects even with a reais cap present
// ===========================================================================
test("reais cap present but margin violated -> approved:false, none, value 0", () => {
  // tight cart: total=120, productCost=100 -> even capped subsidy breaks margin floor
  // raw = 120*0.30 = 36, cap = 16 -> subsidy=16, gross=104, fees=4.16
  // margin = (104-100-4.16)/104 = negative -> < 0.38 -> reject
  const cart: Cart = {
    currency: "BRL",
    total: 120,
    items: [{ sku: "A", name: "A", price: 60, cost: 50, quantity: 2 }]
  };
  const result = evaluateDiscountOffer(cart, rules, 30, 16);
  assert.equal(result.approved, false);
  assert.equal(result.type, "none");
  assert.equal(result.value, 0);
  assert.equal(result.reason, "minimum_margin_violation");
});

// ===========================================================================
// Guard: cart.total 0 with a cap -> value 0, no crash / no divide-by-zero
// ===========================================================================
test("reais cap with cart.total 0 -> value 0, no crash", () => {
  const cart: Cart = { currency: "BRL", total: 0, items: [] };
  const result = evaluateDiscountOffer(cart, rules, 30, 16);
  assert.equal(result.value, 0);
  assert.equal(result.approved, false);
  assert.equal(result.type, "none");
  assert.ok(Number.isFinite(result.value), "value must be finite (no NaN from /0)");
});
