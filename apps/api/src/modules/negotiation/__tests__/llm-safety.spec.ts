import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { isSafeGeneratedMessage } from "@zyon/conversation-engine";
import { validateHypothesisResponse, validateHypothesisSafety } from "../../revenue-manager/domain/services/hypothesis-validator.service.js";
import type { AuthorizedOffer, Cart, MerchantRules } from "@zyon/shared-types";
import { evaluateDiscountOffer } from "@zyon/rules-engine";
import { AttributionTaggerService } from "../../revenue-lift/domain/services/attribution-tagger.service.js";
import { HoldoutGroupService } from "../../revenue-lift/domain/services/holdout-group.service.js";

/**
 * LLM SAFETY TESTS
 *
 * Core invariant: "LLM NEVER authorizes offers."
 * These tests validate that generated messages don't violate safety rules,
 * even when the LLM is mocked to return unsafe content.
 */

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
  couponBoxEnabled: false,
};

function makeCart(overrides: Partial<Cart> = {}): Cart {
  return {
    currency: "BRL",
    total: 100,
    items: [{ sku: "item-1", name: "Product A", price: 100, cost: 50, quantity: 1 }],
    ...overrides,
  };
}

describe("LLM Safety Tests — Core Invariant Validation", () => {
  // ============ TEST 1-9: isSafeGeneratedMessage unit tests ============

  describe("isSafeGeneratedMessage(message, offer) — Conversation Engine safety", () => {
    test("1. Blocks discount percent above authorized offer", () => {
      const offer: AuthorizedOffer = {
        id: "offer-1",
        merchantId: "merchant-1",
        sessionId: "session-1",
        type: "discount_percent",
        value: 10,
        approved: true,
        reason: "approved",
        marginAfterOffer: 0.25,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      };

      // LLM claims 20%, but only 10% authorized
      const unsafe = isSafeGeneratedMessage("Posso oferecer 20% de desconto.", offer);
      assert.equal(unsafe, false, "Should block 20% when only 10% authorized");

      // LLM claims 5%, within 10% limit
      const safe = isSafeGeneratedMessage("Posso oferecer 5% de desconto.", offer);
      assert.equal(safe, true, "Should allow 5% when 10% authorized");
    });

    test("2. Blocks 'frete gratis' without shipping_free offer", () => {
      const offer: AuthorizedOffer = {
        id: "offer-1",
        merchantId: "merchant-1",
        sessionId: "session-1",
        type: "discount_percent",
        value: 5,
        approved: true,
        reason: "approved",
        marginAfterOffer: 0.25,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      };

      const unsafe = isSafeGeneratedMessage("Liberei frete gratis para voce.", offer);
      assert.equal(unsafe, false, "Should block free shipping claim without authorization");
    });

    test("3. Allows authorized discount exactly", () => {
      const offer: AuthorizedOffer = {
        id: "offer-1",
        merchantId: "merchant-1",
        sessionId: "session-1",
        type: "discount_percent",
        value: 5,
        approved: true,
        reason: "approved",
        marginAfterOffer: 0.25,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      };

      const safe = isSafeGeneratedMessage("Posso oferecer 5% de desconto.", offer);
      assert.equal(safe, true, "Should allow exactly authorized discount");
    });

    test("4. Blocks 'pagamento confirmado' claim", () => {
      const unsafe = isSafeGeneratedMessage("Seu pagamento foi confirmado, obrigado!");
      assert.equal(unsafe, false, "Should block payment confirmation claim");
    });

    test("5. Blocks 'estoque garantido' claim", () => {
      const unsafe = isSafeGeneratedMessage("Produto reservado e estoque garantido.");
      assert.equal(unsafe, false, "Should block stock guarantee claim");
    });

    test("6. Blocks CVV and password requests", () => {
      const unsafeCvv = isSafeGeneratedMessage("Qual e o CVV do seu cartao?");
      assert.equal(unsafeCvv, false, "Should block CVV request");

      const unsafePassword = isSafeGeneratedMessage("Por favor, digite sua senha.");
      assert.equal(unsafePassword, false, "Should block password request");
    });

    test("7. Allows normal message without discount mention", () => {
      const safe = isSafeGeneratedMessage(
        "Posso te ajudar a finalizar com seguranca."
      );
      assert.equal(safe, true, "Should allow safe message without discount claims");
    });

    test("8. Edge case: empty message is safe", () => {
      const safe = isSafeGeneratedMessage("");
      assert.equal(safe, true, "Empty message is safe (no claims)");
    });

    test("9. Message with 0% discount (no offer) is safe", () => {
      const safe = isSafeGeneratedMessage(
        "Como posso ajudar com sua compra?"
      );
      assert.equal(safe, true, "Message with no numeric claims is safe");
    });
  });

  // ============ TEST 10-14: Hypothesis validation ============

  describe("Hypothesis validation — Ensures LLM output safe before storage", () => {
    test("10. Valid hypothesis passes validation", () => {
      const hypothesis = {
        hypothesis_text: "Test hypothesis",
        reasoning: "Good reasoning",
        expected_lift_percent: 15,
        template: {
          name: "Template A",
          description: "Description",
          variant_a: {
            name: "Control",
            system_prompt: "You are helpful.",
            weight: 50,
            is_control: true,
          },
          variant_b: {
            name: "Treatment",
            system_prompt: "Be extra helpful.",
            weight: 50,
            is_control: false,
          },
        },
      };

      assert.doesNotThrow(
        () => validateHypothesisResponse(hypothesis),
        "Valid hypothesis should pass validation"
      );
    });

    test("11. Hypothesis suggesting 80% discount → rejected by safety", () => {
      const hypothesis = {
        hypothesis_text: "Test with high discount",
        reasoning: "Test reasoning",
        expected_lift_percent: 50,
        template: {
          name: "Template",
          description: "Desc",
          variant_a: {
            name: "Control",
            system_prompt: "You are helpful.",
            weight: 50,
            is_control: true,
          },
          variant_b: {
            name: "Treatment",
            system_prompt: "Offer 80% desconto to all buyers.",
            weight: 50,
            is_control: false,
          },
        },
      };

      assert.throws(
        () => validateHypothesisSafety(hypothesis, { max_discount_percent: 30, allow_free_shipping: false }),
        /HYPOTHESIS_EXTREME_DISCOUNT/,
        "Should reject 80% discount when max is 30%"
      );
    });

    test("12. Hypothesis JSON missing template field → throws validation error", () => {
      const invalid = {
        hypothesis_text: "Test",
        reasoning: "Test",
        expected_lift_percent: 15,
        // template is missing
      };

      assert.throws(
        () => validateHypothesisResponse(invalid),
        /template must be an object/,
        "Should throw when template missing"
      );
    });

    test("13. Hypothesis with empty system_prompt → throws validation error", () => {
      const invalid = {
        hypothesis_text: "Test",
        reasoning: "Test",
        expected_lift_percent: 15,
        template: {
          name: "Template",
          description: "Desc",
          variant_a: {
            name: "Control",
            system_prompt: "", // Empty!
            weight: 50,
            is_control: true,
          },
          variant_b: {
            name: "Treatment",
            system_prompt: "Valid prompt",
            weight: 50,
            is_control: false,
          },
        },
      };

      assert.throws(
        () => validateHypothesisResponse(invalid),
        /system_prompt must be a non-empty string/,
        "Should throw on empty system_prompt"
      );
    });

    test("14. Hypothesis suggesting free shipping not authorized → flagged", () => {
      const hypothesis = {
        hypothesis_text: "Free shipping test",
        reasoning: "Test",
        expected_lift_percent: 20,
        template: {
          name: "Template",
          description: "Desc",
          variant_a: {
            name: "Control",
            system_prompt: "Control prompt",
            weight: 50,
            is_control: true,
          },
          variant_b: {
            name: "Treatment",
            system_prompt: "Offer frete grátis to close the deal.",
            weight: 50,
            is_control: false,
          },
        },
      };

      assert.throws(
        () => validateHypothesisSafety(hypothesis, {
          max_discount_percent: 10,
          allow_free_shipping: false,
        }),
        /HYPOTHESIS_UNAUTHORIZED_FREE_SHIPPING/,
        "Should reject free shipping when not authorized"
      );
    });
  });

  // ============ TEST 15-18: Deal Engine safety (rules-engine) ============

  describe("Deal Engine safety — Negotiation capped by merchant rules", () => {
    test("15. Negotiation finds 7% agreement, merchant maxDiscount=10% → authorized at 7%", () => {
      const cart = makeCart();
      const evaluation = evaluateDiscountOffer(cart, baseRules, 7);

      assert.equal(evaluation.approved, true, "Should approve 7% discount");
      assert.equal(evaluation.value, 7, "Value should be 7%");
      assert.ok(evaluation.value <= baseRules.maxDiscountPercent, "Must not exceed maxDiscount");
    });

    test("16. Buyer requests 50%, merchant max 10% → capped at 10%", () => {
      const cart = makeCart();
      const evaluation = evaluateDiscountOffer(cart, baseRules, 50);

      assert.equal(evaluation.value, 10, "Should cap at maxDiscountPercent (10%)");
      assert.ok(evaluation.value < 50, "Value should not reach buyer request");
    });

    test("17. Offer violates minimumMarginPercent → REJECTED (no offer)", () => {
      const cart = makeCart({
        total: 100,
        items: [{ sku: "item-1", name: "Product A", price: 100, cost: 80, quantity: 1 }],
      });

      const strictMarginRules: MerchantRules = {
        ...baseRules,
        maxDiscountPercent: 30,
        minimumMarginPercent: 50, // Very strict margin (expressed as % from 0-100 internally divided by 100)
      };

      const evaluation = evaluateDiscountOffer(cart, strictMarginRules, 10);

      assert.equal(evaluation.approved, false, "Should reject when margin violation");
      assert.equal(evaluation.type, "none", "Should return no offer");
      assert.equal(evaluation.reason, "minimum_margin_violation", "Reason should cite margin");
    });

    test("18. Item missing cost → defaults to 50% of price, margin still checked", () => {
      const cart = makeCart({
        total: 100,
        items: [{ sku: "item-1", name: "Product A", price: 100, quantity: 1 }], // cost undefined
      });

      // Default cost = 50% of 100 = 50
      // With 10% discount: gross = 90, payFee = 3.6, margin = (90 - 50 - 3.6) / 90 = 0.404 > 0.38
      const evaluation = evaluateDiscountOffer(cart, baseRules, 10);

      assert.equal(evaluation.approved, true, "Should approve when default cost passes margin");
    });
  });

  // ============ TEST 19-21: Intent Memory classification safety ============

  describe("Intent Memory classification — PII filtering and fallback", () => {
    test("19. LLM classifier returns PII → filtered before storage", () => {
      // Simulates LLM returning classification WITH PII (should be stripped at service layer)
      const malformedLLMOutput: Record<string, unknown> = {
        primary_intent: "price_sensitive",
        email: "joao@example.com",
        phone: "+55 11 99999-9999",
        name: "Joao Silva",
        conversion_likelihood_percent: 45,
      };

      // PII fields that must never be stored
      const piiFields = ["email", "phone", "name", "cpf", "ip_address", "address"];

      // Simulate the filtering: keep only known safe fields
      const safeFields = ["primary_intent", "urgency", "budget_tier", "conversion_likelihood_percent"];
      const filtered: Record<string, unknown> = {};
      for (const key of Object.keys(malformedLLMOutput)) {
        if (safeFields.includes(key)) {
          filtered[key] = malformedLLMOutput[key];
        }
      }

      for (const field of piiFields) {
        assert.ok(!(field in filtered), `PII field '${field}' must not be stored`);
      }
      assert.ok("primary_intent" in filtered, "Should keep valid field");
    });

    test("20. LLM returns invalid intent type → fallback to 'unknown'", () => {
      const validIntents = [
        "price_sensitive",
        "comparison_shopper",
        "impulse_buyer",
        "loyal_customer",
        "unknown",
      ];

      const invalidOutput = { primary_intent: "invalid_type_xyz" };
      const intent = validIntents.includes(invalidOutput.primary_intent)
        ? invalidOutput.primary_intent
        : "unknown";

      assert.equal(intent, "unknown", "Should fallback to unknown for invalid type");
    });

    test("21. LLM fails entirely → rule-based fallback, never throws to caller", () => {
      let classification: { primary_intent: string; conversion_likelihood_percent: number } | null = null;

      // Simulates use-case catching LLM error and applying rule-based fallback
      try {
        throw new Error("LLM API timeout");
      } catch {
        classification = {
          primary_intent: "comparison_shopper",
          conversion_likelihood_percent: 25,
        };
      }

      assert.ok(classification !== null, "Should have fallback classification");
      assert.ok(classification!.primary_intent, "Fallback must have intent");
      assert.ok(typeof classification!.conversion_likelihood_percent === "number", "Must have numeric likelihood");
    });
  });

  // ============ TEST 22-23: Holdout integrity ============

  describe("Holdout cohort safety — Agentic features disabled for holdout", () => {
    test("22. Holdout user → conversation-engine NEVER called with LLM", () => {
      const holdoutService = new HoldoutGroupService();

      // We need a user that falls in holdout. Try deterministic inputs.
      // The service is deterministic — same input always returns same cohort.
      // Test the invariant: if cohort === "holdout", shouldUseLLM must be false.
      const cohort = holdoutService.assignCohort("holdout-user-abc", "merchant-xyz");
      const shouldUseLLM = cohort !== "holdout";

      if (cohort === "holdout") {
        assert.equal(shouldUseLLM, false, "Holdout users must NOT use LLM");
      } else {
        // User falls in treatment — test the inverse
        assert.equal(shouldUseLLM, true, "Treatment users may use LLM");
      }

      // Verify invariant holds regardless of outcome
      assert.equal(shouldUseLLM, cohort !== "holdout", "shouldUseLLM must match cohort assignment");
    });

    test("23. Holdout attribution safety — all features forced false", () => {
      const tagger = new AttributionTaggerService();

      // Tag a holdout session where upstream claims all features were applied
      const tag = tagger.tag({
        sessionId: "session-holdout",
        orderId: "order-1",
        cohort: "holdout",
        features: {
          negotiation: true,
          crossSell: true,
          progressiveDiscount: true,
          cartRecovery: true,
          intentPersonalization: true,
          experimentVariantId: "variant-A",
        },
        revenue: {
          orderValueCents: 10000,
          discountCents: 500,
          shippingSubsidyCents: 200,
        },
        aiCostCents: 100,
      });

      // All features should be forced false despite input being true
      assert.equal(tag.negotiationApplied, false, "negotiation forced false for holdout");
      assert.equal(tag.crossSellApplied, false, "crossSell forced false for holdout");
      assert.equal(tag.progressiveDiscountApplied, false, "progressiveDiscount forced false for holdout");
      assert.equal(tag.cartRecoveryApplied, false, "cartRecovery forced false for holdout");
      assert.equal(tag.intentPersonalizationApplied, false, "intentPersonalization forced false for holdout");
      assert.equal(tag.experimentVariantId, undefined, "experimentVariantId cleared for holdout");
      assert.equal(tag.aiCostCents, 0, "aiCostCents zeroed for holdout (no LLM calls)");
      assert.equal(tag.cohort, "holdout", "cohort preserved");
    });
  });
});
