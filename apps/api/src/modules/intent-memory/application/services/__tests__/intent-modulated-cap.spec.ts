import { test, describe } from "node:test";
import * as assert from "node:assert/strict";
import type { Cart, MerchantRules } from "@zyon/shared-types";
import type { IntentSnapshot } from "../intent-modulated-cap.service.js";
import { IntentModulatedCapService } from "../intent-modulated-cap.service.js";

describe("IntentModulatedCapService", () => {
  let service: IntentModulatedCapService;

  // Setup
  test.beforeEach(() => {
    service = new IntentModulatedCapService();
  });

  const defaultRules: MerchantRules = {
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
    autonomousEngineEnabled: true,
  };

  const createCart = (total: number): Cart => ({
    currency: "BRL",
    total,
    items: [],
  });

  // ADI-F1-02: price_sensitive → cap toward max
  describe("resolveDiscountCap", () => {
    test("price_sensitive intent returns maxDiscountPercent", () => {
      const intent: IntentSnapshot = {
        primary_intent: "price_sensitive",
        urgency: "high",
        budget_tier: "budget",
        pain_points: [],
      };

      const cap = service.resolveDiscountCap(intent, defaultRules, 0);
      assert.equal(cap, defaultRules.maxDiscountPercent);
    });

    // ADI-F1-02: quality_seeker → cap toward min
    test("quality_seeker intent returns minOffer (0)", () => {
      const intent: IntentSnapshot = {
        primary_intent: "quality_seeker",
        urgency: "medium",
        budget_tier: "premium",
        pain_points: [],
      };

      const cap = service.resolveDiscountCap(intent, defaultRules, 5);
      assert.equal(cap, 0);
    });

    // ADI-F1-02: ready_to_buy → cap toward min
    test("ready_to_buy intent returns minOffer (0)", () => {
      const intent: IntentSnapshot = {
        primary_intent: "ready_to_buy",
        urgency: "high",
        budget_tier: "mid",
        pain_points: [],
      };

      const cap = service.resolveDiscountCap(intent, defaultRules, 5);
      assert.equal(cap, 0);
    });

    // ADI-F1-06: no intent → fallback to max
    test("undefined intent returns maxDiscountPercent (fallback)", () => {
      const cap = service.resolveDiscountCap(undefined, defaultRules, 0);
      assert.equal(cap, defaultRules.maxDiscountPercent);
    });

    // ADI-F1-04: result always clamped to [0, maxDiscountPercent]
    test("clamps result between 0 and maxDiscountPercent", () => {
      const intent: IntentSnapshot = {
        primary_intent: "price_sensitive",
        urgency: "high",
        budget_tier: "budget",
        pain_points: [],
      };

      // Even with price_sensitive (max), should not exceed rule's max
      const cap = service.resolveDiscountCap(intent, defaultRules, 0);
      assert.ok(cap >= 0);
      assert.ok(cap <= defaultRules.maxDiscountPercent);
    });

    // ADI-F1-04: never go below 0
    test("never returns negative cap", () => {
      const intent: IntentSnapshot = {
        primary_intent: "quality_seeker",
        urgency: "medium",
        budget_tier: "premium",
        pain_points: [],
      };

      const cap = service.resolveDiscountCap(intent, defaultRules, 100);
      assert.ok(cap >= 0);
    });
  });

  // ADI-F1-03: shipping nudge logic
  describe("resolveShippingNudge", () => {
    // ADI-F1-03: price_sensitive + cart >= 85% threshold → nudge
    test("price_sensitive at 85% threshold triggers nudge", () => {
      const intent: IntentSnapshot = {
        primary_intent: "price_sensitive",
        urgency: "high",
        budget_tier: "budget",
        pain_points: [],
      };

      // 85% of 250 = 212.5
      const cart = createCart(212.5);

      const result = service.resolveShippingNudge(intent, cart, defaultRules);
      assert.equal(result.nudge, true);
    });

    test("price_sensitive above 85% threshold triggers nudge", () => {
      const intent: IntentSnapshot = {
        primary_intent: "price_sensitive",
        urgency: "high",
        budget_tier: "budget",
        pain_points: [],
      };

      // 90% of 250 = 225
      const cart = createCart(225);

      const result = service.resolveShippingNudge(intent, cart, defaultRules);
      assert.equal(result.nudge, true);
    });

    test("price_sensitive below 85% threshold does not nudge", () => {
      const intent: IntentSnapshot = {
        primary_intent: "price_sensitive",
        urgency: "high",
        budget_tier: "budget",
        pain_points: [],
      };

      // 80% of 250 = 200 (below 85%)
      const cart = createCart(200);

      const result = service.resolveShippingNudge(intent, cart, defaultRules);
      assert.equal(result.nudge, false);
    });

    // ADI-F1-03: quality_seeker never nudges, regardless of cart value
    test("quality_seeker does not nudge even at 100% threshold", () => {
      const intent: IntentSnapshot = {
        primary_intent: "quality_seeker",
        urgency: "medium",
        budget_tier: "premium",
        pain_points: [],
      };

      // Even at 250+ cart value
      const cart = createCart(300);

      const result = service.resolveShippingNudge(intent, cart, defaultRules);
      assert.equal(result.nudge, false);
    });

    test("no intent does not nudge", () => {
      const cart = createCart(250);

      const result = service.resolveShippingNudge(undefined, cart, defaultRules);
      assert.equal(result.nudge, false);
    });

    test("ready_to_buy does not nudge even at threshold", () => {
      const intent: IntentSnapshot = {
        primary_intent: "ready_to_buy",
        urgency: "high",
        budget_tier: "mid",
        pain_points: [],
      };

      const cart = createCart(220);

      const result = service.resolveShippingNudge(intent, cart, defaultRules);
      assert.equal(result.nudge, false);
    });
  });

  // Edge cases
  describe("edge cases", () => {
    test("zero cart total with nudge attempt", () => {
      const intent: IntentSnapshot = {
        primary_intent: "price_sensitive",
        urgency: "high",
        budget_tier: "budget",
        pain_points: [],
      };

      const cart = createCart(0);
      const result = service.resolveShippingNudge(intent, cart, defaultRules);
      assert.equal(result.nudge, false);
    });

    test("empty intent object still uses defaults", () => {
      const intent = {
        primary_intent: "",
        urgency: "low" as const,
        budget_tier: "budget" as const,
        pain_points: [],
      };

      // Empty intent should fall back to max
      const cap = service.resolveDiscountCap(intent, defaultRules, 0);
      assert.equal(cap, defaultRules.maxDiscountPercent);
    });

    test("rules with zero maxDiscountPercent", () => {
      const rulesZeroMax = { ...defaultRules, maxDiscountPercent: 0 };
      const intent: IntentSnapshot = {
        primary_intent: "price_sensitive",
        urgency: "high",
        budget_tier: "budget",
        pain_points: [],
      };

      const cap = service.resolveDiscountCap(intent, rulesZeroMax, 0);
      assert.equal(cap, 0);
    });
  });
});
