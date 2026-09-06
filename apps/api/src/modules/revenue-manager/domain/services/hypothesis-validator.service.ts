import type { HypothesisGenerationResponse } from "../ports/hypothesis-generator.port.js";

/**
 * Validates the LLM-generated hypothesis response.
 * Throws ConstraintViolation if invalid.
 * Ensures structural correctness + safety guards.
 */
export function validateHypothesisResponse(response: unknown): asserts response is HypothesisGenerationResponse {
  if (!response || typeof response !== "object") {
    throw new Error("HYPOTHESIS_INVALID_JSON: Response must be an object");
  }

  const r = response as Record<string, unknown>;

  // Required top-level fields
  if (typeof r.hypothesis_text !== "string" || r.hypothesis_text.trim().length === 0) {
    throw new Error("HYPOTHESIS_INVALID_JSON: hypothesis_text must be a non-empty string");
  }
  if (typeof r.reasoning !== "string" || r.reasoning.trim().length === 0) {
    throw new Error("HYPOTHESIS_INVALID_JSON: reasoning must be a non-empty string");
  }
  if (typeof r.expected_lift_percent !== "number" || !Number.isFinite(r.expected_lift_percent) || r.expected_lift_percent < 0 || r.expected_lift_percent > 200) {
    throw new Error("HYPOTHESIS_INVALID_JSON: expected_lift_percent must be a number between 0 and 200");
  }

  // Template validation
  if (!r.template || typeof r.template !== "object") {
    throw new Error("HYPOTHESIS_INVALID_JSON: template must be an object");
  }

  const t = r.template as Record<string, unknown>;
  if (typeof t.name !== "string" || t.name.trim().length === 0) {
    throw new Error("HYPOTHESIS_INVALID_JSON: template.name must be a non-empty string");
  }
  if (typeof t.description !== "string") {
    throw new Error("HYPOTHESIS_INVALID_JSON: template.description must be a string");
  }

  // Validate variant_a and variant_b
  validateVariant(t.variant_a, "variant_a");
  validateVariant(t.variant_b, "variant_b");

  // Ensure exactly one control
  const aIsControl = (t.variant_a as Record<string, unknown>).is_control;
  const bIsControl = (t.variant_b as Record<string, unknown>).is_control;
  if (aIsControl === bIsControl) {
    throw new Error("HYPOTHESIS_INVALID_JSON: Exactly one variant must be the control (is_control: true)");
  }

  // Weight sum validation
  const aWeight = (t.variant_a as Record<string, unknown>).weight as number;
  const bWeight = (t.variant_b as Record<string, unknown>).weight as number;
  if (aWeight + bWeight !== 100) {
    throw new Error("HYPOTHESIS_INVALID_JSON: variant weights must sum to 100");
  }
}

function validateVariant(variant: unknown, label: string): void {
  if (!variant || typeof variant !== "object") {
    throw new Error(`HYPOTHESIS_INVALID_JSON: template.${label} must be an object`);
  }
  const v = variant as Record<string, unknown>;
  if (typeof v.name !== "string" || v.name.trim().length === 0) {
    throw new Error(`HYPOTHESIS_INVALID_JSON: template.${label}.name must be a non-empty string`);
  }
  if (typeof v.system_prompt !== "string" || v.system_prompt.trim().length === 0) {
    throw new Error(`HYPOTHESIS_INVALID_JSON: template.${label}.system_prompt must be a non-empty string`);
  }
  if (typeof v.weight !== "number" || !Number.isFinite(v.weight) || v.weight < 1 || v.weight > 99) {
    throw new Error(`HYPOTHESIS_INVALID_JSON: template.${label}.weight must be 1-99`);
  }
  if (typeof v.is_control !== "boolean") {
    throw new Error(`HYPOTHESIS_INVALID_JSON: template.${label}.is_control must be a boolean`);
  }
}

/**
 * LLM Prompt Safety Guards
 * Validates that the generated hypothesis does NOT:
 * - Suggest discounts above the actual merchant cap
 * - Promise free shipping without authorization
 * - Claim delivery guarantees
 * - Request sensitive information (CVV, password)
 */
export function validateHypothesisSafety(response: HypothesisGenerationResponse, constraints: {
  max_discount_percent: number;
  allow_free_shipping: boolean;
}, currentPrompt?: string): void {
  if (!Number.isFinite(constraints.max_discount_percent) || constraints.max_discount_percent < 0 || constraints.max_discount_percent > 100 || typeof constraints.allow_free_shipping !== "boolean") {
    throw new Error("HYPOTHESIS_INVALID_MERCHANT_RULES: Explicit commercial limits are required");
  }
  const systemPrompts = [
    response.hypothesis_text,
    response.template.name,
    response.template.description,
    // Trusted, unchanged baseline guardrails may themselves mention forbidden actions.
    ...(response.template.variant_a.system_prompt === currentPrompt ? [] : [response.template.variant_a.system_prompt]),
    proposedPrompt(response.template.variant_b.system_prompt, currentPrompt),
  ];

  for (const prompt of systemPrompts) {
    const lowerPrompt = prompt.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

    // Check for extreme discount mentions
    const discountPattern = /(\d+(?:[.,]\d+)?)\s*%\s*(?:(?:de|off)\s+)?(?:off|desconto|discount)|(?:desconto|discount|save|economize)\s*(?:(?:de|of|up to|ate)\s*)?(\d+(?:[.,]\d+)?)\s*%/g;
    for (const discountMatch of lowerPrompt.matchAll(discountPattern)) {
      const discountValue = Number((discountMatch[1] ?? discountMatch[2]).replace(",", "."));
      if (discountValue > constraints.max_discount_percent) {
        throw new Error(
          `HYPOTHESIS_EXTREME_DISCOUNT: Prompt mentions ${discountValue}% discount, max allowed is ${constraints.max_discount_percent}%`,
        );
      }
    }

    // Check for free shipping without authorization
    if (!constraints.allow_free_shipping) {
      if (/free (?:shipping|delivery)|frete gratis|frete gratuito|entrega gratis|cover (?:the )?shipping costs/.test(lowerPrompt)) {
        throw new Error("HYPOTHESIS_UNAUTHORIZED_FREE_SHIPPING: Free shipping not authorized by merchant");
      }
    }

    // Check for forbidden claims
    const forbiddenPatterns = [
      { pattern: /cvv|cvc|security code|código de segurança/i, reason: "Must never request CVV/security code" },
      { pattern: /password|senha/i, reason: "Must never request password" },
      { pattern: /guarantee.*delivery|garantia.*entrega/i, reason: "Must not guarantee delivery without authorization" },
    ];

    for (const { pattern, reason } of forbiddenPatterns) {
      if (pattern.test(prompt)) {
        throw new Error(`HYPOTHESIS_SAFETY_VIOLATION: ${reason}`);
      }
    }
  }
}

/** Strip only an exact trusted baseline; the remaining challenger instructions are new. */
export function proposedPrompt(prompt: string, currentPrompt?: string): string {
  if (currentPrompt && (prompt === currentPrompt || prompt.startsWith(`${currentPrompt}\n`))) {
    return prompt.slice(currentPrompt.length);
  }
  return prompt;
}
