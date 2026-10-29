import test from "node:test";
import assert from "node:assert/strict";
import {
  type BuyerNegotiationPreferences,
  type MerchantNegotiationPolicy,
  negotiateDiscount
} from "../index.js";

// ============================================================================
// Test Fixtures
// ============================================================================

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

// ============================================================================
// Scenario 1: Merchant Max Discount Capped
// ============================================================================

test("Scenario 1.1: denies when buyer minimum exceeds merchant maximum (no overlap)", () => {
  // Buyer minimumAcceptable 12%, merchant max 10% → no_discount_overlap
  const result = negotiateDiscount({
    merchantId: "mrc_1",
    cart: { total: 300, items: [{ sku: "basic", price: 300, quantity: 1 }] },
    merchantPolicy: { ...merchantPolicy, global: { minOfferDiscountPercent: 3, maxDiscountPercent: 10 } },
    buyerPreferences: { ...buyerPreferences, targetDiscountPercent: 15, minimumAcceptableDiscountPercent: 12 }
  });

  assert.equal(result.agreement, false, "Agreement should be false when buyer minimum exceeds merchant maximum");
  assert.equal(result.denialReason, "no_discount_overlap");
  assert.equal(result.selectedDiscountPercent, 12, "Selected discount is buyer's minimum acceptable");
});

test("Scenario 1.1b: agrees when buyer minimum exactly equals merchant maximum", () => {
  // Buyer minimumAcceptable 10%, merchant max 10% → agreement at 10%
  const result = negotiateDiscount({
    merchantId: "mrc_1",
    cart: { total: 300, items: [{ sku: "basic", price: 300, quantity: 1 }] },
    merchantPolicy: { ...merchantPolicy, global: { minOfferDiscountPercent: 3, maxDiscountPercent: 10 } },
    buyerPreferences: { ...buyerPreferences, targetDiscountPercent: 15, minimumAcceptableDiscountPercent: 10 }
  });

  assert.equal(result.agreement, true, "Buyer min = merchant max is still a valid overlap");
  assert.equal(result.selectedDiscountPercent, 10);
});

test("Scenario 1.2: accepts discount within merchant range", () => {
  // Buyer min 5%, merchant range 3–10% → select 5%
  const result = negotiateDiscount({
    merchantId: "mrc_1",
    cart: { total: 300, items: [{ sku: "basic", price: 300, quantity: 1 }] },
    merchantPolicy: { ...merchantPolicy, global: { minOfferDiscountPercent: 3, maxDiscountPercent: 10 } },
    buyerPreferences: { ...buyerPreferences, targetDiscountPercent: 15, minimumAcceptableDiscountPercent: 5 }
  });

  assert.equal(result.agreement, true);
  assert.equal(result.selectedDiscountPercent, 5, "Discount should be buyer minimum when within range");
  assert.equal(result.merchantMaxDiscountPercent, 10);
});

test("Scenario 1.3: merchant max is hard cap regardless of negotiation", () => {
  // Merchant max 5%, but system should never exceed it
  const result = negotiateDiscount({
    merchantId: "mrc_1",
    cart: { total: 100, items: [{ sku: "item", price: 100, quantity: 1 }] },
    merchantPolicy: { ...merchantPolicy, global: { minOfferDiscountPercent: 2, maxDiscountPercent: 5 } },
    buyerPreferences: { ...buyerPreferences, targetDiscountPercent: 8, minimumAcceptableDiscountPercent: 3 }
  });

  assert.equal(result.agreement, true);
  assert.equal(result.selectedDiscountPercent, 3, "Selected discount within buyer and merchant ranges");
  assert.equal(result.merchantMaxDiscountPercent, 5);
});

// ============================================================================
// Scenario 2: Scope Resolution (Item > Category > Global)
// ============================================================================

test("Scenario 2.1: item policy overrides category and global", () => {
  // SKU has item policy (2–6%), category policy (5–10%), global (3–10%)
  const result = negotiateDiscount({
    merchantId: "mrc_1",
    cart: { total: 100, items: [{ sku: "vip-kit", categoryId: "premium", price: 100, quantity: 1 }] },
    merchantPolicy,
    buyerPreferences: { ...buyerPreferences, targetDiscountPercent: 10, minimumAcceptableDiscountPercent: 3 }
  });

  assert.equal(result.agreement, true);
  assert.equal(result.selectedScope, "item", "Item policy should take precedence");
  assert.equal(result.merchantMaxDiscountPercent, 6, "Item max is 6%");
  assert.equal(result.selectedDiscountPercent, 3, "Buyer min within item range");
  assert(result.selectedPolicyKeys.includes("vip-kit"), "Should reference item SKU");
});

test("Scenario 2.2: category policy overrides global when no item match", () => {
  const result = negotiateDiscount({
    merchantId: "mrc_1",
    cart: { total: 100, items: [{ sku: "cat-item", categoryId: "premium", price: 100, quantity: 1 }] },
    merchantPolicy: {
      enabled: true,
      global: { minOfferDiscountPercent: 2, maxDiscountPercent: 5 },
      categories: [{ categoryId: "premium", minOfferDiscountPercent: 8, maxDiscountPercent: 15 }],
      maxRounds: 4,
      estimatedCostPerAiCallCents: 5
    },
    buyerPreferences: { ...buyerPreferences, targetDiscountPercent: 12, minimumAcceptableDiscountPercent: 10 }
  });

  assert.equal(result.agreement, true);
  assert.equal(result.selectedScope, "category", "Category policy takes precedence over global");
  assert.equal(result.selectedDiscountPercent, 10, "Buyer minimum within category range");
});

test("Scenario 2.3: global policy applies when no item/category match", () => {
  const result = negotiateDiscount({
    merchantId: "mrc_1",
    cart: { total: 100, items: [{ sku: "generic", price: 100, quantity: 1 }] },
    merchantPolicy: {
      enabled: true,
      global: { minOfferDiscountPercent: 3, maxDiscountPercent: 10 },
      categories: [{ categoryId: "special", minOfferDiscountPercent: 20, maxDiscountPercent: 30 }],
      maxRounds: 4,
      estimatedCostPerAiCallCents: 5
    },
    buyerPreferences: { ...buyerPreferences, targetDiscountPercent: 8, minimumAcceptableDiscountPercent: 5 }
  });

  assert.equal(result.agreement, true);
  assert.equal(result.selectedScope, "global", "Global policy applies when no specific match");
  assert.equal(result.selectedDiscountPercent, 5);
});

test("Scenario 2.4: most restrictive max wins in multi-item cart", () => {
  // Item 1: global (3–10%), Item 2: category (5–8%)
  // Result should be restricted to 5–8%
  const result = negotiateDiscount({
    merchantId: "mrc_1",
    cart: { total: 200, items: [
      { sku: "item1", price: 100, quantity: 1 },
      { sku: "item2", categoryId: "premium", price: 100, quantity: 1 }
    ] },
    merchantPolicy: {
      enabled: true,
      global: { minOfferDiscountPercent: 3, maxDiscountPercent: 10 },
      categories: [{ categoryId: "premium", minOfferDiscountPercent: 5, maxDiscountPercent: 8 }],
      maxRounds: 4,
      estimatedCostPerAiCallCents: 5
    },
    buyerPreferences: { ...buyerPreferences, targetDiscountPercent: 9, minimumAcceptableDiscountPercent: 6 }
  });

  assert.equal(result.agreement, true);
  assert.equal(result.selectedScope, "category", "Mixed scope → category");
  assert.equal(result.merchantMaxDiscountPercent, 8, "Max is minimum of all items' maxes");
  assert.equal(result.selectedDiscountPercent, 6);
});

// ============================================================================
// Scenario 3: AI Cost Cap
// ============================================================================

test("Scenario 3.1: denies when estimated cost exceeds merchant cap", () => {
  // 4 rounds × 2 calls/round × 5¢/call = 40¢
  // Merchant cap: 30¢ → deny
  const result = negotiateDiscount({
    merchantId: "mrc_1",
    cart: { total: 300, items: [{ sku: "basic", price: 300, quantity: 1 }] },
    merchantPolicy: {
      enabled: true,
      global: { minOfferDiscountPercent: 3, maxDiscountPercent: 10 },
      maxRounds: 4,
      maxAiCostCents: 30,
      estimatedCostPerAiCallCents: 5
    },
    buyerPreferences: { ...buyerPreferences, maxRounds: 4 }
  });

  assert.equal(result.agreement, false);
  assert.equal(result.denialReason, "ai_cost_cap_exceeded");
  assert.equal(result.estimatedAiCostCents, 40, "4 rounds × 2 calls × 5¢ = 40¢");
});

test("Scenario 3.2: denies when estimated cost exceeds buyer cap", () => {
  // 2 rounds × 2 calls × 5¢ = 20¢ > 10¢ cap
  const result = negotiateDiscount({
    merchantId: "mrc_1",
    cart: { total: 100, items: [{ sku: "item", price: 100, quantity: 1 }] },
    merchantPolicy: { ...merchantPolicy, estimatedCostPerAiCallCents: 5 },
    buyerPreferences: { ...buyerPreferences, maxRounds: 2, maxAiCostCents: 10 }
  });

  assert.equal(result.agreement, false);
  assert.equal(result.denialReason, "ai_cost_cap_exceeded");
  assert.equal(result.estimatedAiCostCents, 20, "2 rounds × 2 calls × 5¢ = 20¢");
});

test("Scenario 3.3: uses minimum of merchant/buyer rounds for cost estimation", () => {
  // Merchant allows 5 rounds, buyer 3 → use 3
  // 3 × 2 × 10¢ = 60¢
  const result = negotiateDiscount({
    merchantId: "mrc_1",
    cart: { total: 100, items: [{ sku: "item", price: 100, quantity: 1 }] },
    merchantPolicy: { ...merchantPolicy, maxRounds: 5, estimatedCostPerAiCallCents: 10, maxAiCostCents: 100 },
    buyerPreferences: { ...buyerPreferences, maxRounds: 3, maxAiCostCents: 100 }
  });

  assert.equal(result.agreement, true);
  assert.equal(result.maxRounds, 3, "Uses minimum of merchant/buyer");
  assert.equal(result.estimatedAiCalls, 6, "3 rounds × 2 calls");
  assert.equal(result.estimatedAiCostCents, 60);
});

test("Scenario 3.4: cost cap 0 is valid and denies all negotiations", () => {
  const result = negotiateDiscount({
    merchantId: "mrc_1",
    cart: { total: 100, items: [{ sku: "item", price: 100, quantity: 1 }] },
    merchantPolicy: { ...merchantPolicy, maxAiCostCents: 0, estimatedCostPerAiCallCents: 1 },
    buyerPreferences: { ...buyerPreferences, maxRounds: 1 }
  });

  assert.equal(result.agreement, false);
  assert.equal(result.denialReason, "ai_cost_cap_exceeded");
});

// ============================================================================
// Scenario 4: No Discount Overlap
// ============================================================================

test("Scenario 4.1: denies when buyer minimum exceeds merchant maximum", () => {
  // Buyer min 12%, merchant max 10%
  const result = negotiateDiscount({
    merchantId: "mrc_1",
    cart: { total: 100, items: [{ sku: "item", price: 100, quantity: 1 }] },
    merchantPolicy: { ...merchantPolicy, global: { minOfferDiscountPercent: 3, maxDiscountPercent: 10 } },
    buyerPreferences: { ...buyerPreferences, minimumAcceptableDiscountPercent: 12 }
  });

  assert.equal(result.agreement, false);
  assert.equal(result.denialReason, "no_discount_overlap");
});

test("Scenario 4.2: accepts when merchant minimum equals buyer minimum", () => {
  const result = negotiateDiscount({
    merchantId: "mrc_1",
    cart: { total: 100, items: [{ sku: "item", price: 100, quantity: 1 }] },
    merchantPolicy: { ...merchantPolicy, global: { minOfferDiscountPercent: 5, maxDiscountPercent: 10 } },
    buyerPreferences: { ...buyerPreferences, minimumAcceptableDiscountPercent: 5 }
  });

  assert.equal(result.agreement, true);
  assert.equal(result.selectedDiscountPercent, 5);
});

// ============================================================================
// Scenario 5: Human Confirmation Gate
// ============================================================================

test("Scenario 5.1: requires human confirmation when cart > threshold", () => {
  const result = negotiateDiscount({
    merchantId: "mrc_1",
    cart: { total: 2000, items: [{ sku: "item", price: 2000, quantity: 1 }] },
    merchantPolicy,
    buyerPreferences: { ...buyerPreferences, requireHumanConfirmationAbove: 1000 }
  });

  assert.equal(result.agreement, true);
  assert.equal(result.requiresHumanConfirmation, true, "Cart 2000 > threshold 1000");
});

test("Scenario 5.2: does NOT require confirmation when cart <= threshold", () => {
  const result = negotiateDiscount({
    merchantId: "mrc_1",
    cart: { total: 500, items: [{ sku: "item", price: 500, quantity: 1 }] },
    merchantPolicy,
    buyerPreferences: { ...buyerPreferences, requireHumanConfirmationAbove: 1000 }
  });

  assert.equal(result.agreement, true);
  assert.equal(result.requiresHumanConfirmation, false, "Cart 500 <= threshold 1000");
});

test("Scenario 5.3: Bug 9 regression — threshold 0 means ALWAYS require confirmation", () => {
  // cart.total (1) > threshold (0) → true
  const result = negotiateDiscount({
    merchantId: "mrc_1",
    cart: { total: 1, items: [{ sku: "item", price: 1, quantity: 1 }] },
    merchantPolicy,
    buyerPreferences: { ...buyerPreferences, requireHumanConfirmationAbove: 0 }
  });

  assert.equal(result.agreement, true);
  assert.equal(result.requiresHumanConfirmation, true, "Threshold 0 must work (was broken by Boolean coercion)");
});

test("Scenario 5.4: does NOT require confirmation when threshold is undefined", () => {
  const { requireHumanConfirmationAbove: _omit, ...prefsWithout } = buyerPreferences;
  const result = negotiateDiscount({
    merchantId: "mrc_1",
    cart: { total: 9999, items: [{ sku: "item", price: 9999, quantity: 1 }] },
    merchantPolicy,
    buyerPreferences: prefsWithout
  });

  assert.equal(result.agreement, true);
  assert.equal(result.requiresHumanConfirmation, false, "Undefined threshold means no confirmation needed");
});

// ============================================================================
// Scenario 6: Disabled Features (Early Denial)
// ============================================================================

test("Scenario 6.1: merchant disabled returns denial with no agreement", () => {
  const result = negotiateDiscount({
    merchantId: "mrc_1",
    cart: { total: 100, items: [{ sku: "item", price: 100, quantity: 1 }] },
    merchantPolicy: { ...merchantPolicy, enabled: false },
    buyerPreferences
  });

  assert.equal(result.agreement, false);
  assert.equal(result.denialReason, "merchant_machine_negotiation_disabled");
  assert(result.audit.some(a => a.includes("Merchant disabled")));
});

test("Scenario 6.2: buyer disabled returns denial with no agreement", () => {
  const result = negotiateDiscount({
    merchantId: "mrc_1",
    cart: { total: 100, items: [{ sku: "item", price: 100, quantity: 1 }] },
    merchantPolicy,
    buyerPreferences: { ...buyerPreferences, enabled: false }
  });

  assert.equal(result.agreement, false);
  assert.equal(result.denialReason, "buyer_machine_negotiation_disabled");
  assert(result.audit.some(a => a.includes("Buyer disabled")));
});

test("Scenario 6.3: both disabled returns merchant denial first", () => {
  const result = negotiateDiscount({
    merchantId: "mrc_1",
    cart: { total: 100, items: [{ sku: "item", price: 100, quantity: 1 }] },
    merchantPolicy: { ...merchantPolicy, enabled: false },
    buyerPreferences: { ...buyerPreferences, enabled: false }
  });

  assert.equal(result.agreement, false);
  assert.equal(result.denialReason, "merchant_machine_negotiation_disabled");
});

// ============================================================================
// Scenario 7: Invalid Policy
// ============================================================================

test("Scenario 7.1: invalid policy (min > max) returns denial", () => {
  const result = negotiateDiscount({
    merchantId: "mrc_1",
    cart: { total: 100, items: [{ sku: "item", price: 100, quantity: 1 }] },
    merchantPolicy: {
      enabled: true,
      global: { minOfferDiscountPercent: 15, maxDiscountPercent: 10 }, // min > max
      maxRounds: 4,
      estimatedCostPerAiCallCents: 5
    },
    buyerPreferences
  });

  assert.equal(result.agreement, false);
  assert.equal(result.denialReason, "invalid_policy");
});

test("Scenario 7.2: negative discount in policy returns denial", () => {
  const result = negotiateDiscount({
    merchantId: "mrc_1",
    cart: { total: 100, items: [{ sku: "item", price: 100, quantity: 1 }] },
    merchantPolicy: {
      enabled: true,
      global: { minOfferDiscountPercent: -5, maxDiscountPercent: 10 },
      maxRounds: 4,
      estimatedCostPerAiCallCents: 5
    },
    buyerPreferences
  });

  assert.equal(result.agreement, false);
  assert.equal(result.denialReason, "invalid_policy");
});

// ============================================================================
// Scenario 8: AutoAccept Flag
// ============================================================================

test("Scenario 8.1: passes autoAccept from buyer preferences", () => {
  const result = negotiateDiscount({
    merchantId: "mrc_1",
    cart: { total: 100, items: [{ sku: "item", price: 100, quantity: 1 }] },
    merchantPolicy,
    buyerPreferences: { ...buyerPreferences, autoAccept: true }
  });

  assert.equal(result.agreement, true);
  assert.equal(result.autoAccept, true);
});

test("Scenario 8.2: preserves autoAccept false from buyer preferences", () => {
  const result = negotiateDiscount({
    merchantId: "mrc_1",
    cart: { total: 100, items: [{ sku: "item", price: 100, quantity: 1 }] },
    merchantPolicy,
    buyerPreferences: { ...buyerPreferences, autoAccept: false }
  });

  assert.equal(result.agreement, true);
  assert.equal(result.autoAccept, false);
});

// ============================================================================
// Scenario 9: Audit Trail
// ============================================================================

test("Scenario 9.1: includes audit trail explaining negotiation flow", () => {
  const result = negotiateDiscount({
    merchantId: "mrc_1",
    cart: { total: 100, items: [{ sku: "item", price: 100, quantity: 1 }] },
    merchantPolicy,
    buyerPreferences
  });

  assert(result.audit.length > 0, "Should have audit entries");
  assert(result.audit.some(a => a.includes("AI calls")), "Should mention AI cost");
  assert(result.audit.some(a => a.includes("policy")), "Should mention policy resolution");
});

test("Scenario 9.2: audit trail explains denial reason", () => {
  const result = negotiateDiscount({
    merchantId: "mrc_1",
    cart: { total: 100, items: [{ sku: "item", price: 100, quantity: 1 }] },
    merchantPolicy: { ...merchantPolicy, enabled: false },
    buyerPreferences
  });

  assert(result.audit.some(a => a.includes("Merchant disabled")), "Should explain merchant disabled");
});
