import test from "node:test";
import assert from "node:assert/strict";
import { authorizeShippingDiscount, evaluateShippingOffer } from "./index.js";
import { DEFAULT_MERCHANT_RULES } from "@zyon/shared-types";

test("shipping incentives protect full carrier shortfall and require a complete quote", () => {
  const input = { cart: { currency: "BRL", total: 300, items: [{ sku: "a", name: "A", quantity: 1, price: 300, cost: 100 }] },
    shipping: { customerPrice: 20, realCost: 65, region: "SP" },
    rules: { ...DEFAULT_MERCHANT_RULES, allowShippingDiscount: true, allowFreeShipping: true, maxShippingSubsidy: 45 },
    requestedDiscount: 0.01, type: "shipping_discount_fixed" as const };
  assert.equal(authorizeShippingDiscount(input).reason, "shipping_subsidy_above_limit");
  assert.equal(authorizeShippingDiscount({ ...input, shipping: { ...input.shipping, realCost: 64.99 } }).approved, true);
  assert.equal(authorizeShippingDiscount({ ...input, shipping: { customerPrice: 20 } }).reason, "shipping_quote_missing");
  assert.equal(authorizeShippingDiscount({ ...input, cart: { ...input.cart, currentDiscount: 31 },
    rules: { ...input.rules, allowStackDiscountAndFreeShipping: true } }).reason, "existing_discount_above_limit");
  assert.equal(authorizeShippingDiscount({ ...input, rules: { ...input.rules, blockedRegions: ["SP"] } }).reason, "blocked_shipping_region");
});

test("a full shipping waiver cannot bypass free-shipping policy by using a fixed coupon", () => {
  const input = { cart: { currency: "BRL", total: 100, items: [{ sku: "a", name: "A", quantity: 1, price: 100, cost: 20 }] },
    shipping: { customerPrice: 10, realCost: 10 },
    rules: { ...DEFAULT_MERCHANT_RULES, allowShippingDiscount: true, allowFreeShipping: false },
    requestedDiscount: 10, type: "shipping_discount_fixed" as const };
  assert.equal(authorizeShippingDiscount(input).reason, "free_shipping_not_allowed");
  assert.equal(authorizeShippingDiscount({ ...input, rules: { ...input.rules, allowFreeShipping: true } }).reason, "free_shipping_minimum_not_met");
});

test("evaluateShippingOffer blocks free shipping when stacking is disabled and cart already has discount", () => {
  const result = evaluateShippingOffer({
    cart: {
      currency: "BRL",
      total: 300,
      currentDiscount: 40,
      items: [{ sku: "a", name: "A", quantity: 1, price: 300, cost: 100 }]
    },
    shipping: {
      customerPrice: 25,
      realCost: 18,
      region: "SP"
    },
    rules: {
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
      autonomousEngineEnabled: true,
    },
    abandonmentScore: 0.9
  });

  assert.equal(result.approved, false);
  assert.equal(result.reason, "stack_discount_and_free_shipping_not_allowed");
  assert.equal(result.type, "none");
});

test("evaluateShippingOffer still allows free shipping when stacking is enabled", () => {
  const result = evaluateShippingOffer({
    cart: {
      currency: "BRL",
      total: 300,
      currentDiscount: 40,
      items: [{ sku: "a", name: "A", quantity: 1, price: 300, cost: 100 }]
    },
    shipping: {
      customerPrice: 25,
      realCost: 18,
      region: "SP"
    },
    rules: {
      maxDiscountPercent: 20,
      minimumMarginPercent: 38,
      allowFreeShipping: true,
      allowShippingDiscount: true,
      allowBonusItem: false,
      allowStackDiscountAndFreeShipping: true,
      freeShippingMinCartValue: 250,
      maxShippingSubsidy: 45,
      maxPartialShippingDiscount: 20,
      offerExpirationMinutes: 15,
      blockedRegions: [],
      brandVoice: "consultative",
      couponBoxEnabled: true,
      autonomousEngineEnabled: true,
    },
    abandonmentScore: 0.9
  });

  assert.equal(result.approved, true);
  assert.equal(result.type, "shipping_free");
  assert.equal(result.value, 25);
});
