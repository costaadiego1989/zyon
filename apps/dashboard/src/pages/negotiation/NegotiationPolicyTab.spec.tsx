import { describe, expect, it, vi } from "vitest";
import { validatePolicy } from "./NegotiationPolicyTab.js";
import type { NegotiationPolicy } from "../../api-client.js";

describe("validatePolicy", () => {
  function validPolicy(): NegotiationPolicy {
    return {
      enabled: true,
      global: { minOfferDiscountPercent: 3, maxDiscountPercent: 15 },
      maxRounds: 2,
      estimatedCostPerAiCallCents: 1,
    };
  }

  it("returns empty errors for valid policy", () => {
    expect(Object.keys(validatePolicy(validPolicy()))).toHaveLength(0);
  });

  it("rejects negative global min", () => {
    const p = validPolicy();
    p.global.minOfferDiscountPercent = -1;
    const errors = validatePolicy(p);
    expect(errors["global.min"]).toBeDefined();
  });

  it("rejects global max over 100", () => {
    const p = validPolicy();
    p.global.maxDiscountPercent = 101;
    const errors = validatePolicy(p);
    expect(errors["global.max"]).toBeDefined();
  });

  it("rejects min greater than max", () => {
    const p = validPolicy();
    p.global.minOfferDiscountPercent = 20;
    p.global.maxDiscountPercent = 10;
    const errors = validatePolicy(p);
    expect(errors["global.range"]).toBeDefined();
  });

  it("rejects maxRounds less than 1", () => {
    const p = validPolicy();
    p.maxRounds = 0;
    const errors = validatePolicy(p);
    expect(errors["maxRounds"]).toBeDefined();
  });

  it("rejects negative cost per call", () => {
    const p = validPolicy();
    p.estimatedCostPerAiCallCents = -5;
    const errors = validatePolicy(p);
    expect(errors["costPerCall"]).toBeDefined();
  });

  it("rejects maxAiCostCents of zero", () => {
    const p = validPolicy();
    p.maxAiCostCents = 0;
    const errors = validatePolicy(p);
    expect(errors["maxAiCost"]).toBeDefined();
  });

  it("allows undefined maxAiCostCents", () => {
    const p = validPolicy();
    p.maxAiCostCents = undefined;
    const errors = validatePolicy(p);
    expect(errors["maxAiCost"]).toBeUndefined();
  });

  it("validates category overrides", () => {
    const p = validPolicy();
    p.categories = [
      { categoryId: "", minOfferDiscountPercent: 5, maxDiscountPercent: 3 },
    ];
    const errors = validatePolicy(p);
    expect(errors["cat.0.id"]).toBeDefined();
    expect(errors["cat.0.range"]).toBeDefined();
  });

  it("validates item overrides", () => {
    const p = validPolicy();
    p.items = [
      { sku: "", minOfferDiscountPercent: 10, maxDiscountPercent: 5 },
    ];
    const errors = validatePolicy(p);
    expect(errors["item.0.sku"]).toBeDefined();
    expect(errors["item.0.range"]).toBeDefined();
  });
});
