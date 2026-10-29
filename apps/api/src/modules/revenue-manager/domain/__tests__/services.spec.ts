import test from "node:test";
import assert from "node:assert/strict";
import { validateHypothesisResponse, validateHypothesisSafety } from "../services/hypothesis-validator.service.js";
import { assessRiskLevel, shouldAutoApprove } from "../value-objects/hypothesis-risk-level.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function validResponse(): any {
  return {
    hypothesis_text: "Offer 10% discount to shipping abandoners",
    reasoning: "47% abandonment rate at shipping step",
    expected_lift_percent: 12,
    template: {
      name: "Shipping Discount V1",
      description: "Test discount vs no offer",
      variant_a: {
        name: "Control",
        system_prompt: "Assist buyer normally",
        weight: 50,
        is_control: true,
      },
      variant_b: {
        name: "Offer",
        system_prompt: "Offer 10% discount at shipping",
        weight: 50,
        is_control: false,
      },
    },
  };
}

test("validateHypothesisResponse — schema validation", async (t) => {
  await t.test("accepts valid response", () => {
    const r = validResponse();
    assert.doesNotThrow(() => validateHypothesisResponse(r));
  });

  await t.test("rejects null", () => {
    assert.throws(() => validateHypothesisResponse(null), /HYPOTHESIS_INVALID_JSON/);
  });

  await t.test("rejects undefined", () => {
    assert.throws(() => validateHypothesisResponse(undefined), /HYPOTHESIS_INVALID_JSON/);
  });

  await t.test("rejects non-object (string)", () => {
    assert.throws(() => validateHypothesisResponse("invalid"), /HYPOTHESIS_INVALID_JSON/);
  });

  await t.test("rejects non-object (number)", () => {
    assert.throws(() => validateHypothesisResponse(42), /HYPOTHESIS_INVALID_JSON/);
  });

  await t.test("rejects missing hypothesis_text", () => {
    const r = validResponse();
    delete r.hypothesis_text;
    assert.throws(() => validateHypothesisResponse(r), /hypothesis_text/);
  });

  await t.test("rejects empty hypothesis_text", () => {
    const r = validResponse();
    r.hypothesis_text = "";
    assert.throws(() => validateHypothesisResponse(r), /non-empty string/);
  });

  await t.test("rejects whitespace-only hypothesis_text", () => {
    const r = validResponse();
    r.hypothesis_text = "   ";
    assert.throws(() => validateHypothesisResponse(r), /non-empty string/);
  });

  await t.test("rejects missing reasoning", () => {
    const r = validResponse();
    delete r.reasoning;
    assert.throws(() => validateHypothesisResponse(r), /reasoning/);
  });

  await t.test("rejects empty reasoning", () => {
    const r = validResponse();
    r.reasoning = "";
    assert.throws(() => validateHypothesisResponse(r), /non-empty string/);
  });

  await t.test("rejects negative expected_lift_percent", () => {
    const r = validResponse();
    r.expected_lift_percent = -5;
    assert.throws(() => validateHypothesisResponse(r), /must be.*between 0 and 200/);
  });

  await t.test("rejects expected_lift_percent > 200", () => {
    const r = validResponse();
    r.expected_lift_percent = 500;
    assert.throws(() => validateHypothesisResponse(r), /must be.*between 0 and 200/);
  });

  await t.test("accepts expected_lift_percent at boundaries (0, 200)", () => {
    const r0 = validResponse();
    r0.expected_lift_percent = 0;
    assert.doesNotThrow(() => validateHypothesisResponse(r0));

    const r200 = validResponse();
    r200.expected_lift_percent = 200;
    assert.doesNotThrow(() => validateHypothesisResponse(r200));
  });

  await t.test("rejects missing template", () => {
    const r = validResponse();
    delete r.template;
    assert.throws(() => validateHypothesisResponse(r), /template/);
  });

  await t.test("rejects missing variant_a", () => {
    const r = validResponse();
    delete r.template.variant_a;
    assert.throws(() => validateHypothesisResponse(r), /variant_a/);
  });

  await t.test("rejects missing variant_b", () => {
    const r = validResponse();
    delete r.template.variant_b;
    assert.throws(() => validateHypothesisResponse(r), /variant_b/);
  });

  await t.test("rejects empty variant_a.system_prompt", () => {
    const r = validResponse();
    r.template.variant_a.system_prompt = "";
    assert.throws(() => validateHypothesisResponse(r), /system_prompt.*must be a non-empty string/);
  });

  await t.test("rejects empty variant_b.system_prompt", () => {
    const r = validResponse();
    r.template.variant_b.system_prompt = "   ";
    assert.throws(() => validateHypothesisResponse(r), /system_prompt.*must be a non-empty string/);
  });

  await t.test("rejects weight < 1", () => {
    const r = validResponse();
    r.template.variant_a.weight = 0;
    assert.throws(() => validateHypothesisResponse(r), /weight must be 1-99/);
  });

  await t.test("rejects weight > 99", () => {
    const r = validResponse();
    r.template.variant_a.weight = 100;
    assert.throws(() => validateHypothesisResponse(r), /weight must be 1-99/);
  });

  await t.test("rejects weight sum != 100", () => {
    const r = validResponse();
    r.template.variant_a.weight = 60;
    r.template.variant_b.weight = 30;
    assert.throws(() => validateHypothesisResponse(r), /must sum to 100/);
  });

  await t.test("accepts weight sum = 100 (various combos)", () => {
    const combos = [[50, 50], [60, 40], [70, 30], [1, 99]];
    for (const [a, b] of combos) {
      const r = validResponse();
      r.template.variant_a.weight = a;
      r.template.variant_b.weight = b;
      assert.doesNotThrow(() => validateHypothesisResponse(r), `weights ${a}/${b} should pass`);
    }
  });

  await t.test("rejects both variants marked as control", () => {
    const r = validResponse();
    r.template.variant_a.is_control = true;
    r.template.variant_b.is_control = true;
    assert.throws(() => validateHypothesisResponse(r), /Exactly one variant/);
  });

  await t.test("rejects neither variant marked as control", () => {
    const r = validResponse();
    r.template.variant_a.is_control = false;
    r.template.variant_b.is_control = false;
    assert.throws(() => validateHypothesisResponse(r), /Exactly one variant/);
  });

  await t.test("accepts when variant_a is control", () => {
    const r = validResponse();
    r.template.variant_a.is_control = true;
    r.template.variant_b.is_control = false;
    assert.doesNotThrow(() => validateHypothesisResponse(r));
  });

  await t.test("accepts when variant_b is control", () => {
    const r = validResponse();
    r.template.variant_a.is_control = false;
    r.template.variant_b.is_control = true;
    assert.doesNotThrow(() => validateHypothesisResponse(r));
  });
});

test("validateHypothesisSafety — LLM guardrails", async (t) => {
  const constraints = { max_discount_percent: 50, allow_free_shipping: false };

  await t.test("passes safe response", () => {
    const r = validResponse();
    assert.doesNotThrow(() => validateHypothesisSafety(r, constraints));
  });

  await t.test("rejects discount > max (60% > 50%)", () => {
    const r = validResponse();
    r.template.variant_b.system_prompt = "Offer 60% discount immediately!";
    assert.throws(() => validateHypothesisSafety(r, constraints), /HYPOTHESIS_EXTREME_DISCOUNT/);
  });

  await t.test("accepts discount at exactly max (50%)", () => {
    const r = validResponse();
    r.template.variant_b.system_prompt = "Offer 50% off to loyal customers";
    assert.doesNotThrow(() => validateHypothesisSafety(r, constraints));
  });

  await t.test("accepts discount below max (30% < 50%)", () => {
    const r = validResponse();
    r.template.variant_b.system_prompt = "Offer 30% off";
    assert.doesNotThrow(() => validateHypothesisSafety(r, constraints));
  });

  await t.test("rejects unauthorized free shipping (English)", () => {
    const r = validResponse();
    r.template.variant_b.system_prompt = "Offer free shipping to all";
    assert.throws(() => validateHypothesisSafety(r, constraints), /HYPOTHESIS_UNAUTHORIZED_FREE_SHIPPING/);
  });

  await t.test("rejects unauthorized free shipping (Portuguese)", () => {
    const r = validResponse();
    r.template.variant_b.system_prompt = "Ofereça frete grátis para todos";
    assert.throws(() => validateHypothesisSafety(r, constraints), /HYPOTHESIS_UNAUTHORIZED_FREE_SHIPPING/);
  });

  await t.test("rejects unauthorized free shipping (alternative Portuguese)", () => {
    const r = validResponse();
    r.template.variant_b.system_prompt = "Frete gratuito na compra";
    assert.throws(() => validateHypothesisSafety(r, constraints), /HYPOTHESIS_UNAUTHORIZED_FREE_SHIPPING/);
  });

  await t.test("accepts free shipping when merchant authorized", () => {
    const r = validResponse();
    r.template.variant_b.system_prompt = "Offer free shipping to all";
    const authorizedConstraints = { max_discount_percent: 50, allow_free_shipping: true };
    assert.doesNotThrow(() => validateHypothesisSafety(r, authorizedConstraints));
  });

  await t.test("rejects CVV request (English)", () => {
    const r = validResponse();
    r.template.variant_b.system_prompt = "Ask for their CVV to verify";
    assert.throws(() => validateHypothesisSafety(r, constraints), /HYPOTHESIS_SAFETY_VIOLATION.*CVV/);
  });

  await t.test("rejects CVC request", () => {
    const r = validResponse();
    r.template.variant_b.system_prompt = "Verify CVC code";
    assert.throws(() => validateHypothesisSafety(r, constraints), /HYPOTHESIS_SAFETY_VIOLATION.*CVV/);
  });

  await t.test("rejects password request (English)", () => {
    const r = validResponse();
    r.template.variant_b.system_prompt = "Ask them to type their password";
    assert.throws(() => validateHypothesisSafety(r, constraints), /HYPOTHESIS_SAFETY_VIOLATION.*password/);
  });

  await t.test("rejects password request (Portuguese)", () => {
    const r = validResponse();
    r.template.variant_b.system_prompt = "Pede a senha do cliente";
    assert.throws(() => validateHypothesisSafety(r, constraints), /HYPOTHESIS_SAFETY_VIOLATION.*password/);
  });

  await t.test("rejects delivery guarantee (English)", () => {
    const r = validResponse();
    r.template.variant_b.system_prompt = "We guarantee delivery within 24 hours";
    assert.throws(() => validateHypothesisSafety(r, constraints), /HYPOTHESIS_SAFETY_VIOLATION.*guarantee/);
  });

  await t.test("rejects delivery guarantee (Portuguese)", () => {
    const r = validResponse();
    r.template.variant_b.system_prompt = "Garantia de entrega em 24 horas";
    assert.throws(() => validateHypothesisSafety(r, constraints), /HYPOTHESIS_SAFETY_VIOLATION.*guarantee/);
  });

  await t.test("rejects violation in variant_a", () => {
    const r = validResponse();
    r.template.variant_a.system_prompt = "Ask for CVV";
    r.template.variant_b.system_prompt = "Safe prompt";
    assert.throws(() => validateHypothesisSafety(r, constraints), /CVV/);
  });

  await t.test("rejects violation in variant_b", () => {
    const r = validResponse();
    r.template.variant_a.system_prompt = "Safe prompt";
    r.template.variant_b.system_prompt = "Request password";
    assert.throws(() => validateHypothesisSafety(r, constraints), /password/);
  });

  await t.test("case-insensitive pattern matching (lowercase CVV)", () => {
    const r = validResponse();
    r.template.variant_b.system_prompt = "Request cvv from customer";
    assert.throws(() => validateHypothesisSafety(r, constraints), /CVV/);
  });

  await t.test("case-insensitive pattern matching (uppercase PASSWORD)", () => {
    const r = validResponse();
    r.template.variant_b.system_prompt = "Ask for PASSWORD";
    assert.throws(() => validateHypothesisSafety(r, constraints), /password/);
  });
});

test("assessRiskLevel — risk categorization", async (t) => {
  await t.test("lift < 10% and discount <= 30% → low", () => {
    assert.strictEqual(assessRiskLevel(5, 20), "low");
    assert.strictEqual(assessRiskLevel(0, 0), "low");
    assert.strictEqual(assessRiskLevel(9, 30), "low");
  });

  await t.test("lift at 10% boundary → medium", () => {
    assert.strictEqual(assessRiskLevel(10, 20), "medium");
  });

  await t.test("lift 10-50% and discount <= 30% → medium", () => {
    assert.strictEqual(assessRiskLevel(10, 20), "medium");
    assert.strictEqual(assessRiskLevel(25, 15), "medium");
    assert.strictEqual(assessRiskLevel(49, 30), "medium");
  });

  await t.test("lift at 50% boundary → high", () => {
    assert.strictEqual(assessRiskLevel(50, 20), "high");
  });

  await t.test("lift >= 50% → high regardless of discount", () => {
    assert.strictEqual(assessRiskLevel(50, 10), "high");
    assert.strictEqual(assessRiskLevel(100, 0), "high");
    assert.strictEqual(assessRiskLevel(60, 50), "high");
  });

  await t.test("discount at 30% boundary with low lift → low", () => {
    assert.strictEqual(assessRiskLevel(5, 30), "low");
  });

  await t.test("discount > 30% → high regardless of lift", () => {
    assert.strictEqual(assessRiskLevel(5, 31), "high");
    assert.strictEqual(assessRiskLevel(5, 35), "high");
    assert.strictEqual(assessRiskLevel(5, 60), "high");
  });

  await t.test("discount undefined (no max) with low lift → low", () => {
    assert.strictEqual(assessRiskLevel(5), "low");
  });

  await t.test("discount undefined (no max) with medium lift → medium", () => {
    assert.strictEqual(assessRiskLevel(25), "medium");
  });

  await t.test("discount undefined (no max) with high lift → high", () => {
    assert.strictEqual(assessRiskLevel(50), "high");
  });
});

test("shouldAutoApprove", async (t) => {
  await t.test("returns true only for 'low' risk", () => {
    assert.strictEqual(shouldAutoApprove("low"), true);
  });

  await t.test("returns false for 'medium' risk", () => {
    assert.strictEqual(shouldAutoApprove("medium"), false);
  });

  await t.test("returns false for 'high' risk", () => {
    assert.strictEqual(shouldAutoApprove("high"), false);
  });
});
