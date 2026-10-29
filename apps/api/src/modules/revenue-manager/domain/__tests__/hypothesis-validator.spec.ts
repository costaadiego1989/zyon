import test from "node:test";
import assert from "node:assert/strict";
import { validateHypothesisResponse, validateHypothesisSafety } from "../services/hypothesis-validator.service.js";
import type { HypothesisGenerationResponse } from "../ports/hypothesis-generator.port.js";

function makeValidResponse(): HypothesisGenerationResponse {
  return {
    hypothesis_text: "Offer 10% discount to users who abandon at payment",
    reasoning: "High abandonment at payment step indicates price sensitivity",
    expected_lift_percent: 12,
    template: {
      name: "Payment Abandonment Discount",
      description: "Test 10% discount vs no offer for payment-stage abandoners",
      variant_a: { name: "Control", system_prompt: "Standard checkout assistance", weight: 50, is_control: true },
      variant_b: { name: "Discount Offer", system_prompt: "Offer 10% discount to hesitant buyers", weight: 50, is_control: false },
    },
  };
}

test("validateHypothesisResponse", async (t) => {
  await t.test("passes for valid response", () => {
    assert.doesNotThrow(() => validateHypothesisResponse(makeValidResponse()));
  });

  await t.test("throws for null/undefined", () => {
    assert.throws(() => validateHypothesisResponse(null), /HYPOTHESIS_INVALID_JSON/);
    assert.throws(() => validateHypothesisResponse(undefined), /HYPOTHESIS_INVALID_JSON/);
  });

  await t.test("throws for non-object (string)", () => {
    assert.throws(() => validateHypothesisResponse("hello"), /HYPOTHESIS_INVALID_JSON/);
  });

  await t.test("throws for missing hypothesis_text", () => {
    const r = makeValidResponse() as unknown as Record<string, unknown>;
    r.hypothesis_text = "";
    assert.throws(() => validateHypothesisResponse(r), /hypothesis_text must be a non-empty string/);
  });

  await t.test("throws for negative expected_lift_percent", () => {
    const r = makeValidResponse();
    r.expected_lift_percent = -5;
    assert.throws(() => validateHypothesisResponse(r), /expected_lift_percent must be a number between 0 and 200/);
  });

  await t.test("throws for expected_lift_percent > 200 (hallucination guard)", () => {
    const r = makeValidResponse();
    r.expected_lift_percent = 500;
    assert.throws(() => validateHypothesisResponse(r), /expected_lift_percent must be a number between 0 and 200/);
  });

  await t.test("throws when both variants are control", () => {
    const r = makeValidResponse();
    r.template.variant_b.is_control = true;
    assert.throws(() => validateHypothesisResponse(r), /Exactly one variant must be the control/);
  });

  await t.test("throws when weights don't sum to 100", () => {
    const r = makeValidResponse();
    r.template.variant_a.weight = 60;
    r.template.variant_b.weight = 60;
    assert.throws(() => validateHypothesisResponse(r), /variant weights must sum to 100/);
  });
});

test("validateHypothesisSafety", async (t) => {
  const defaultConstraints = { max_discount_percent: 50, allow_free_shipping: false };

  await t.test("passes for safe response", () => {
    const r = makeValidResponse();
    assert.doesNotThrow(() => validateHypothesisSafety(r, defaultConstraints));
  });

  await t.test("throws for extreme discount (> max)", () => {
    const r = makeValidResponse();
    r.template.variant_b.system_prompt = "Offer 60% off discount to all users";
    assert.throws(() => validateHypothesisSafety(r, defaultConstraints), /HYPOTHESIS_EXTREME_DISCOUNT/);
  });

  await t.test("passes discount at exactly max allowed", () => {
    const r = makeValidResponse();
    r.template.variant_b.system_prompt = "Offer 50% off discount to premium users";
    assert.doesNotThrow(() => validateHypothesisSafety(r, defaultConstraints));
  });

  await t.test("throws for unauthorized free shipping (English)", () => {
    const r = makeValidResponse();
    r.template.variant_b.system_prompt = "Offer free shipping to all buyers";
    assert.throws(() => validateHypothesisSafety(r, defaultConstraints), /HYPOTHESIS_UNAUTHORIZED_FREE_SHIPPING/);
  });

  await t.test("throws for unauthorized free shipping (Portuguese)", () => {
    const r = makeValidResponse();
    r.template.variant_b.system_prompt = "Ofereça frete grátis para todos os compradores";
    assert.throws(() => validateHypothesisSafety(r, defaultConstraints), /HYPOTHESIS_UNAUTHORIZED_FREE_SHIPPING/);
  });

  await t.test("passes free shipping when authorized", () => {
    const r = makeValidResponse();
    r.template.variant_b.system_prompt = "Offer free shipping to all buyers";
    assert.doesNotThrow(() => validateHypothesisSafety(r, { max_discount_percent: 50, allow_free_shipping: true }));
  });

  await t.test("throws for CVV/security code request", () => {
    const r = makeValidResponse();
    r.template.variant_b.system_prompt = "Ask for their CVV to verify identity";
    assert.throws(() => validateHypothesisSafety(r, defaultConstraints), /HYPOTHESIS_SAFETY_VIOLATION/);
  });

  await t.test("throws for password request", () => {
    const r = makeValidResponse();
    r.template.variant_b.system_prompt = "Ask user to type their password to confirm";
    assert.throws(() => validateHypothesisSafety(r, defaultConstraints), /HYPOTHESIS_SAFETY_VIOLATION/);
  });

  await t.test("throws for delivery guarantee", () => {
    const r = makeValidResponse();
    r.template.variant_b.system_prompt = "We guarantee delivery within 24 hours";
    assert.throws(() => validateHypothesisSafety(r, defaultConstraints), /HYPOTHESIS_SAFETY_VIOLATION/);
  });
});
