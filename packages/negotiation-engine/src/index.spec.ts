import test from "node:test";
import assert from "node:assert/strict";
import {
  type BuyerNegotiationPreferences,
  type MerchantNegotiationPolicy,
  negotiateDiscount
} from "./index.js";

const merchantPolicy: MerchantNegotiationPolicy = {
  enabled: true,
  global: { minOfferDiscountPercent: 3, maxDiscountPercent: 10 },
  categories: [{ categoryId: "premium", minOfferDiscountPercent: 5, maxDiscountPercent: 8 }],
  items: [{ sku: "vip-kit", minOfferDiscountPercent: 2, maxDiscountPercent: 6 }],
  maxRounds: 4,
  maxAiCostCents: 80,
  estimatedCostPerAiCallCents: 5
};

const buyerPreferences: BuyerNegotiationPreferences = {
  enabled: true,
  targetDiscountPercent: 20,
  minimumAcceptableDiscountPercent: 7,
  maxRounds: 3,
  maxAiCostCents: 60,
  autoAccept: true,
  requireHumanConfirmationAbove: 1000
};

test("negotiation engine reaches global agreement at smallest buyer-satisfying discount", () => {
  const result = negotiateDiscount({
    merchantId: "mrc_1",
    cart: { total: 300, items: [{ sku: "basic", price: 300, quantity: 1 }] },
    merchantPolicy,
    buyerPreferences
  });

  assert.equal(result.agreement, true);
  assert.equal(result.selectedScope, "global");
  assert.equal(result.selectedDiscountPercent, 7);
  assert.equal(result.estimatedAiCalls, 6);
  assert.equal(result.estimatedAiCostCents, 30);
  assert.equal(result.autoAccept, true);
});

test("negotiation engine applies category policy before global policy", () => {
  const result = negotiateDiscount({
    merchantId: "mrc_1",
    cart: { total: 300, items: [{ sku: "premium-1", categoryId: "premium", price: 300, quantity: 1 }] },
    merchantPolicy,
    buyerPreferences
  });

  assert.equal(result.agreement, true);
  assert.equal(result.selectedScope, "category");
  assert.equal(result.merchantMinOfferDiscountPercent, 5);
  assert.equal(result.merchantMaxDiscountPercent, 8);
  assert.equal(result.selectedDiscountPercent, 7);
});

test("negotiation engine applies item policy before category policy", () => {
  const result = negotiateDiscount({
    merchantId: "mrc_1",
    cart: { total: 300, items: [{ sku: "vip-kit", categoryId: "premium", price: 300, quantity: 1 }] },
    merchantPolicy,
    buyerPreferences: { ...buyerPreferences, minimumAcceptableDiscountPercent: 5 }
  });

  assert.equal(result.agreement, true);
  assert.equal(result.selectedScope, "item");
  assert.equal(result.merchantMaxDiscountPercent, 6);
  assert.equal(result.selectedDiscountPercent, 5);
});

test("negotiation engine denies when buyer minimum exceeds merchant maximum", () => {
  const result = negotiateDiscount({
    merchantId: "mrc_1",
    cart: { total: 300, items: [{ sku: "vip-kit", categoryId: "premium", price: 300, quantity: 1 }] },
    merchantPolicy,
    buyerPreferences: { ...buyerPreferences, minimumAcceptableDiscountPercent: 9 }
  });

  assert.equal(result.agreement, false);
  assert.equal(result.denialReason, "no_discount_overlap");
  assert.equal(result.selectedDiscountPercent, 9);
});

test("negotiation engine denies when either agent disables machine negotiation", () => {
  const merchantDisabled = negotiateDiscount({
    merchantId: "mrc_1",
    cart: { total: 300, items: [{ sku: "basic", price: 300, quantity: 1 }] },
    merchantPolicy: { ...merchantPolicy, enabled: false },
    buyerPreferences
  });
  const buyerDisabled = negotiateDiscount({
    merchantId: "mrc_1",
    cart: { total: 300, items: [{ sku: "basic", price: 300, quantity: 1 }] },
    merchantPolicy,
    buyerPreferences: { ...buyerPreferences, enabled: false }
  });

  assert.equal(merchantDisabled.denialReason, "merchant_machine_negotiation_disabled");
  assert.equal(buyerDisabled.denialReason, "buyer_machine_negotiation_disabled");
});

test("negotiation engine denies when estimated AI cost exceeds cap", () => {
  const result = negotiateDiscount({
    merchantId: "mrc_1",
    cart: { total: 300, items: [{ sku: "basic", price: 300, quantity: 1 }] },
    merchantPolicy: { ...merchantPolicy, estimatedCostPerAiCallCents: 20 },
    buyerPreferences
  });

  assert.equal(result.agreement, false);
  assert.equal(result.denialReason, "ai_cost_cap_exceeded");
  assert.equal(result.estimatedAiCostCents, 120);
});

test("negotiation engine requires human confirmation above configured cart value", () => {
  const result = negotiateDiscount({
    merchantId: "mrc_1",
    cart: { total: 1200, items: [{ sku: "basic", price: 1200, quantity: 1 }] },
    merchantPolicy,
    buyerPreferences
  });

  assert.equal(result.agreement, true);
  assert.equal(result.requiresHumanConfirmation, true);
});

// Bug 9 regression: threshold of 0 must mean "always require confirmation",
// not skip it. Boolean(0) === false was silently disabling the guardrail.
test("negotiation engine requires human confirmation when threshold is 0 (always confirm)", () => {
  const result = negotiateDiscount({
    merchantId: "mrc_1",
    cart: { total: 1, items: [{ sku: "basic", price: 1, quantity: 1 }] },
    merchantPolicy,
    buyerPreferences: { ...buyerPreferences, requireHumanConfirmationAbove: 0 }
  });

  assert.equal(result.agreement, true);
  // cart.total (1) > threshold (0) → requiresHumanConfirmation must be true
  assert.equal(result.requiresHumanConfirmation, true);
});

test("negotiation engine does NOT require human confirmation when threshold is absent", () => {
  const { requireHumanConfirmationAbove: _omit, ...prefsWithout } = buyerPreferences;
  const result = negotiateDiscount({
    merchantId: "mrc_1",
    cart: { total: 9999, items: [{ sku: "basic", price: 9999, quantity: 1 }] },
    merchantPolicy,
    buyerPreferences: prefsWithout
  });

  assert.equal(result.agreement, true);
  assert.equal(result.requiresHumanConfirmation, false);
});
