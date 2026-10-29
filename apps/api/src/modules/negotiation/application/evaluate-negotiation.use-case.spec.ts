import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { EvaluateNegotiationUseCase } from "./evaluate-negotiation.use-case.js";
import { InMemoryNegotiationStore } from "../infrastructure/in-memory-negotiation.store.js";
import { negotiationCartFingerprint } from "../domain/cart-fingerprint.js";
import type { NegotiationCart, MerchantNegotiationPolicy, BuyerNegotiationPreferences } from "@zyon/negotiation-engine";

describe("EvaluateNegotiationUseCase (Integration)", () => {
  let store: InMemoryNegotiationStore;
  let uc: EvaluateNegotiationUseCase;

  const basePolicy: MerchantNegotiationPolicy = {
    enabled: true,
    global: { minOfferDiscountPercent: 3, maxDiscountPercent: 10 },
    categories: [{ categoryId: "premium", minOfferDiscountPercent: 5, maxDiscountPercent: 8 }],
    items: [{ sku: "vip-kit", minOfferDiscountPercent: 2, maxDiscountPercent: 6 }],
    maxRounds: 4,
    maxAiCostCents: 80,
    estimatedCostPerAiCallCents: 5
  };

  const basePrefs: BuyerNegotiationPreferences = {
    enabled: true,
    targetDiscountPercent: 20,
    minimumAcceptableDiscountPercent: 7,
    maxRounds: 3,
    maxAiCostCents: 60,
    autoAccept: true,
    requireHumanConfirmationAbove: 1000
  };

  before(() => {
    store = new InMemoryNegotiationStore();
    uc = new EvaluateNegotiationUseCase();
  });

  // ========================================================================
  // Scenario 1: Deterministic Engine + Policy Resolution
  // ========================================================================

  it("resolves item policy over category and global scope", () => {
    const cart: NegotiationCart = {
      total: 300,
      items: [
        { sku: "vip-kit", categoryId: "premium", price: 300, quantity: 1 }
      ]
    };

    const result = uc.execute({
      merchantId: "mrc_1",
      globalUserId: "usr_1",
      cart,
      merchantPolicy: basePolicy,
      buyerPreferences: { ...basePrefs, minimumAcceptableDiscountPercent: 5 }
    });

    assert.equal(result.agreement, true);
    assert.equal(result.selectedScope, "item", "Item policy should win");
    assert.equal(result.merchantMaxDiscountPercent, 6, "Item max is 6%");
    assert.equal(result.selectedDiscountPercent, 5, "Buyer min (5%) within item range (2%-6%)");
  });

  it("resolves category policy when no item match", () => {
    const cart: NegotiationCart = {
      total: 300,
      items: [
        { sku: "premium-item", categoryId: "premium", price: 300, quantity: 1 }
      ]
    };

    const result = uc.execute({
      merchantId: "mrc_1",
      cart,
      merchantPolicy: basePolicy,
      buyerPreferences: { ...basePrefs, minimumAcceptableDiscountPercent: 5 }
    });

    assert.equal(result.agreement, true);
    assert.equal(result.selectedScope, "category");
    assert.equal(result.merchantMaxDiscountPercent, 8);
    assert.equal(result.selectedDiscountPercent, 5);
  });

  it("resolves global policy when no item/category match", () => {
    const cart: NegotiationCart = {
      total: 300,
      items: [
        { sku: "generic", price: 300, quantity: 1 }
      ]
    };

    const result = uc.execute({
      merchantId: "mrc_1",
      cart,
      merchantPolicy: basePolicy,
      buyerPreferences: { ...basePrefs, minimumAcceptableDiscountPercent: 5 }
    });

    assert.equal(result.agreement, true);
    assert.equal(result.selectedScope, "global");
    assert.equal(result.merchantMaxDiscountPercent, 10);
  });

  // ========================================================================
  // Scenario 2: Multi-Item Cart (Most Restrictive Scope)
  // ========================================================================

  it("applies most restrictive scope in multi-item cart", () => {
    const cart: NegotiationCart = {
      total: 200,
      items: [
        { sku: "generic", price: 100, quantity: 1 },
        { sku: "vip-kit", categoryId: "premium", price: 100, quantity: 1 }
      ]
    };

    const result = uc.execute({
      merchantId: "mrc_1",
      cart,
      merchantPolicy: basePolicy,
      buyerPreferences: { ...basePrefs, minimumAcceptableDiscountPercent: 4 }
    });

    assert.equal(result.agreement, true);
    assert.equal(result.selectedScope, "item", "Item scope includes vip-kit");
    assert.equal(result.merchantMaxDiscountPercent, 6, "Item max (6%) is most restrictive");
  });

  // ========================================================================
  // Scenario 3: AI Cost Cap Enforcement
  // ========================================================================

  it("denies negotiation when merchant AI cost cap exceeded", () => {
    const cart: NegotiationCart = {
      total: 100,
      items: [{ sku: "item", price: 100, quantity: 1 }]
    };

    const result = uc.execute({
      merchantId: "mrc_2",
      cart,
      merchantPolicy: {
        ...basePolicy,
        maxRounds: 4,
        maxAiCostCents: 30,
        estimatedCostPerAiCallCents: 5
      },
      buyerPreferences: { ...basePrefs, maxRounds: 4 }
    });

    // 4 rounds × 2 calls × 5¢ = 40¢ > 30¢ cap
    assert.equal(result.agreement, false);
    assert.equal(result.denialReason, "ai_cost_cap_exceeded");
    assert.equal(result.estimatedAiCostCents, 40);
  });

  it("denies negotiation when buyer AI cost cap exceeded", () => {
    const cart: NegotiationCart = {
      total: 100,
      items: [{ sku: "item", price: 100, quantity: 1 }]
    };

    const result = uc.execute({
      merchantId: "mrc_2",
      cart,
      merchantPolicy: { ...basePolicy, estimatedCostPerAiCallCents: 5 },
      buyerPreferences: {
        ...basePrefs,
        maxRounds: 2,
        maxAiCostCents: 10
      }
    });

    // 2 rounds × 2 calls × 5¢ = 20¢ > 10¢ buyer cap
    assert.equal(result.agreement, false);
    assert.equal(result.denialReason, "ai_cost_cap_exceeded");
  });

  // ========================================================================
  // Scenario 4: No Discount Overlap
  // ========================================================================

  it("denies when buyer minimum exceeds merchant maximum", () => {
    const cart: NegotiationCart = {
      total: 100,
      items: [{ sku: "vip-kit", price: 100, quantity: 1 }]
    };

    const result = uc.execute({
      merchantId: "mrc_3",
      cart,
      merchantPolicy: basePolicy,
      buyerPreferences: { ...basePrefs, minimumAcceptableDiscountPercent: 12 }
    });

    // Item policy max is 6%, buyer min is 12% → no overlap
    assert.equal(result.agreement, false);
    assert.equal(result.denialReason, "no_discount_overlap");
  });

  // ========================================================================
  // Scenario 5: Human Confirmation Gate
  // ========================================================================

  it("flags requiresHumanConfirmation when cart exceeds threshold", () => {
    const cart: NegotiationCart = {
      total: 2000,
      items: [{ sku: "item", price: 2000, quantity: 1 }]
    };

    const result = uc.execute({
      merchantId: "mrc_1",
      cart,
      merchantPolicy: basePolicy,
      buyerPreferences: { ...basePrefs, requireHumanConfirmationAbove: 1000 }
    });

    assert.equal(result.agreement, true);
    assert.equal(result.requiresHumanConfirmation, true);
  });

  it("does NOT flag requiresHumanConfirmation when cart below threshold", () => {
    const cart: NegotiationCart = {
      total: 500,
      items: [{ sku: "item", price: 500, quantity: 1 }]
    };

    const result = uc.execute({
      merchantId: "mrc_1",
      cart,
      merchantPolicy: basePolicy,
      buyerPreferences: { ...basePrefs, requireHumanConfirmationAbove: 1000 }
    });

    assert.equal(result.agreement, true);
    assert.equal(result.requiresHumanConfirmation, false);
  });

  // ========================================================================
  // Scenario 6: Disabled Features (Early Denial)
  // ========================================================================

  it("denies when merchant negotiation is disabled", () => {
    const cart: NegotiationCart = {
      total: 100,
      items: [{ sku: "item", price: 100, quantity: 1 }]
    };

    const result = uc.execute({
      merchantId: "mrc_disabled",
      cart,
      merchantPolicy: { ...basePolicy, enabled: false },
      buyerPreferences: basePrefs
    });

    assert.equal(result.agreement, false);
    assert.equal(result.denialReason, "merchant_machine_negotiation_disabled");
  });

  it("denies when buyer negotiation is disabled", () => {
    const cart: NegotiationCart = {
      total: 100,
      items: [{ sku: "item", price: 100, quantity: 1 }]
    };

    const result = uc.execute({
      merchantId: "mrc_1",
      cart,
      merchantPolicy: basePolicy,
      buyerPreferences: { ...basePrefs, enabled: false }
    });

    assert.equal(result.agreement, false);
    assert.equal(result.denialReason, "buyer_machine_negotiation_disabled");
  });

  // ========================================================================
  // Scenario 7: AutoAccept Flag
  // ========================================================================

  it("passes autoAccept from buyer preferences", () => {
    const cart: NegotiationCart = {
      total: 100,
      items: [{ sku: "item", price: 100, quantity: 1 }]
    };

    const result = uc.execute({
      merchantId: "mrc_1",
      cart,
      merchantPolicy: basePolicy,
      buyerPreferences: { ...basePrefs, autoAccept: true }
    });

    assert.equal(result.agreement, true);
    assert.equal(result.autoAccept, true);
  });

  it("respects autoAccept false from buyer preferences", () => {
    const cart: NegotiationCart = {
      total: 100,
      items: [{ sku: "item", price: 100, quantity: 1 }]
    };

    const result = uc.execute({
      merchantId: "mrc_1",
      cart,
      merchantPolicy: basePolicy,
      buyerPreferences: { ...basePrefs, autoAccept: false }
    });

    assert.equal(result.agreement, true);
    assert.equal(result.autoAccept, false);
  });

  // ========================================================================
  // Scenario 8: Max Rounds Negotiation
  // ========================================================================

  it("uses minimum of merchant and buyer max rounds", () => {
    const cart: NegotiationCart = {
      total: 100,
      items: [{ sku: "item", price: 100, quantity: 1 }]
    };

    const result = uc.execute({
      merchantId: "mrc_1",
      cart,
      merchantPolicy: { ...basePolicy, maxRounds: 5 },
      buyerPreferences: { ...basePrefs, maxRounds: 3 }
    });

    assert.equal(result.maxRounds, 3, "Should use minimum: 3");
    assert.equal(result.estimatedAiCalls, 6, "3 rounds × 2 calls");
  });

  // ========================================================================
  // Scenario 9: Audit Trail
  // ========================================================================

  it("includes audit trail explaining negotiation", () => {
    const cart: NegotiationCart = {
      total: 100,
      items: [{ sku: "item", price: 100, quantity: 1 }]
    };

    const result = uc.execute({
      merchantId: "mrc_1",
      cart,
      merchantPolicy: basePolicy,
      buyerPreferences: basePrefs
    });

    assert(result.audit.length > 0);
    assert(result.audit.some(a => a.includes("AI calls")), "Should mention AI cost");
    assert(result.audit.some(a => a.includes("policy")), "Should mention policy");
  });

  it("includes audit trail explaining denial", () => {
    const cart: NegotiationCart = {
      total: 100,
      items: [{ sku: "item", price: 100, quantity: 1 }]
    };

    const result = uc.execute({
      merchantId: "mrc_1",
      cart,
      merchantPolicy: { ...basePolicy, enabled: false },
      buyerPreferences: basePrefs
    });

    assert(result.audit.some(a => a.includes("Merchant disabled")));
  });
});
