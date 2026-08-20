import { describe, it, expect } from "vitest";
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

describe("validateHypothesisResponse", () => {
  it("passes for valid response", () => {
    expect(() => validateHypothesisResponse(makeValidResponse())).not.toThrow();
  });

  it("throws for null/undefined", () => {
    expect(() => validateHypothesisResponse(null)).toThrow("HYPOTHESIS_INVALID_JSON");
    expect(() => validateHypothesisResponse(undefined)).toThrow("HYPOTHESIS_INVALID_JSON");
  });

  it("throws for non-object (string)", () => {
    expect(() => validateHypothesisResponse("hello")).toThrow("HYPOTHESIS_INVALID_JSON");
  });

  it("throws for missing hypothesis_text", () => {
    const r = makeValidResponse();
    (r as unknown as Record<string, unknown>).hypothesis_text = "";
    expect(() => validateHypothesisResponse(r)).toThrow("hypothesis_text must be a non-empty string");
  });

  it("throws for missing reasoning", () => {
    const r = makeValidResponse();
    (r as unknown as Record<string, unknown>).reasoning = "";
    expect(() => validateHypothesisResponse(r)).toThrow("reasoning must be a non-empty string");
  });

  it("throws for negative expected_lift_percent", () => {
    const r = makeValidResponse();
    r.expected_lift_percent = -5;
    expect(() => validateHypothesisResponse(r)).toThrow("expected_lift_percent must be a number between 0 and 200");
  });

  it("throws for expected_lift_percent > 200 (hallucination guard)", () => {
    const r = makeValidResponse();
    r.expected_lift_percent = 500;
    expect(() => validateHypothesisResponse(r)).toThrow("expected_lift_percent must be a number between 0 and 200");
  });

  it("throws for missing template", () => {
    const r = makeValidResponse() as unknown as Record<string, unknown>;
    delete r.template;
    expect(() => validateHypothesisResponse(r as HypothesisGenerationResponse)).toThrow("template must be an object");
  });

  it("throws for missing template.name", () => {
    const r = makeValidResponse();
    (r.template as Record<string, unknown>).name = "";
    expect(() => validateHypothesisResponse(r)).toThrow("template.name must be a non-empty string");
  });

  it("throws for missing variant_a", () => {
    const r = makeValidResponse();
    (r.template as Record<string, unknown>).variant_a = null;
    expect(() => validateHypothesisResponse(r)).toThrow("template.variant_a must be an object");
  });

  it("throws for empty system_prompt in variant_b", () => {
    const r = makeValidResponse();
    r.template.variant_b.system_prompt = "";
    expect(() => validateHypothesisResponse(r)).toThrow("template.variant_b.system_prompt must be a non-empty string");
  });

  it("throws when both variants are control", () => {
    const r = makeValidResponse();
    r.template.variant_b.is_control = true;
    expect(() => validateHypothesisResponse(r)).toThrow("Exactly one variant must be the control");
  });

  it("throws when neither variant is control", () => {
    const r = makeValidResponse();
    r.template.variant_a.is_control = false;
    expect(() => validateHypothesisResponse(r)).toThrow("Exactly one variant must be the control");
  });

  it("throws when weights don't sum to 100", () => {
    const r = makeValidResponse();
    r.template.variant_a.weight = 60;
    r.template.variant_b.weight = 60;
    expect(() => validateHypothesisResponse(r)).toThrow("variant weights must sum to 100");
  });

  it("throws for weight < 1", () => {
    const r = makeValidResponse();
    r.template.variant_a.weight = 0;
    expect(() => validateHypothesisResponse(r)).toThrow("template.variant_a.weight must be 1-99");
  });

  it("throws for weight > 99", () => {
    const r = makeValidResponse();
    r.template.variant_a.weight = 100;
    expect(() => validateHypothesisResponse(r)).toThrow("template.variant_a.weight must be 1-99");
  });
});

describe("validateHypothesisSafety", () => {
  const defaultConstraints = { max_discount_percent: 50, allow_free_shipping: false };

  it("passes for safe response", () => {
    const r = makeValidResponse();
    expect(() => validateHypothesisSafety(r, defaultConstraints)).not.toThrow();
  });

  it("throws for extreme discount (> max)", () => {
    const r = makeValidResponse();
    r.template.variant_b.system_prompt = "Offer 60% off discount to all users";
    expect(() => validateHypothesisSafety(r, defaultConstraints)).toThrow("HYPOTHESIS_EXTREME_DISCOUNT");
  });

  it("passes discount at exactly max allowed", () => {
    const r = makeValidResponse();
    r.template.variant_b.system_prompt = "Offer 50% off discount to premium users";
    expect(() => validateHypothesisSafety(r, defaultConstraints)).not.toThrow();
  });

  it("throws for unauthorized free shipping (English)", () => {
    const r = makeValidResponse();
    r.template.variant_b.system_prompt = "Offer free shipping to all buyers";
    expect(() => validateHypothesisSafety(r, defaultConstraints)).toThrow("HYPOTHESIS_UNAUTHORIZED_FREE_SHIPPING");
  });

  it("throws for unauthorized free shipping (Portuguese)", () => {
    const r = makeValidResponse();
    r.template.variant_b.system_prompt = "Ofereça frete grátis para todos os compradores";
    expect(() => validateHypothesisSafety(r, defaultConstraints)).toThrow("HYPOTHESIS_UNAUTHORIZED_FREE_SHIPPING");
  });

  it("passes free shipping when authorized", () => {
    const r = makeValidResponse();
    r.template.variant_b.system_prompt = "Offer free shipping to all buyers";
    expect(() => validateHypothesisSafety(r, { max_discount_percent: 50, allow_free_shipping: true })).not.toThrow();
  });

  it("throws for CVV/security code request", () => {
    const r = makeValidResponse();
    r.template.variant_b.system_prompt = "Ask for their CVV to verify identity";
    expect(() => validateHypothesisSafety(r, defaultConstraints)).toThrow("HYPOTHESIS_SAFETY_VIOLATION");
  });

  it("throws for password request", () => {
    const r = makeValidResponse();
    r.template.variant_b.system_prompt = "Ask user to type their password to confirm";
    expect(() => validateHypothesisSafety(r, defaultConstraints)).toThrow("HYPOTHESIS_SAFETY_VIOLATION");
  });

  it("throws for delivery guarantee", () => {
    const r = makeValidResponse();
    r.template.variant_b.system_prompt = "We guarantee delivery within 24 hours";
    expect(() => validateHypothesisSafety(r, defaultConstraints)).toThrow("HYPOTHESIS_SAFETY_VIOLATION");
  });

  it("throws for security code in Portuguese", () => {
    const r = makeValidResponse();
    r.template.variant_b.system_prompt = "Peça o código de segurança do cartão";
    expect(() => validateHypothesisSafety(r, defaultConstraints)).toThrow("HYPOTHESIS_SAFETY_VIOLATION");
  });
});
