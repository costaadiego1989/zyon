import test from "node:test";
import assert from "node:assert/strict";
import { evaluateShippingOffer } from "./index.js";

test("evaluateShippingOffer blocks free shipping when stacking is disabled and cart already has discount", () => {
  const result = evaluateShippingOffer({
    cart: {
      currency: "BRL",
      total: 300,
      currentDiscount: 40,
      items: []
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
      items: []
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
  assert.equal(result.value, 18);
});
