import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { assertValidMerchantNegotiationPolicy } from "./merchant-negotiation-policy.entity.js";

describe("assertValidMerchantNegotiationPolicy", () => {
  it("accepts valid policy", () => {
    assert.doesNotThrow(() =>
      assertValidMerchantNegotiationPolicy({
        enabled: true,
        global: { minOfferDiscountPercent: 1, maxDiscountPercent: 10 },
        maxRounds: 2,
        estimatedCostPerAiCallCents: 1
      })
    );
  });

  it("rejects inverted global range", () => {
    assert.throws(
      () =>
        assertValidMerchantNegotiationPolicy({
          enabled: true,
          global: { minOfferDiscountPercent: 11, maxDiscountPercent: 5 },
          maxRounds: 1,
          estimatedCostPerAiCallCents: 1
        }),
      /merchant_negotiation_policy_invalid_global/
    );
  });

  // Bug 5 regression: validator must throw BadRequestException (400), not Error (500).
  it("throws BadRequestException (not plain Error) for invalid policy — Bug 5", () => {
    assert.throws(
      () =>
        assertValidMerchantNegotiationPolicy({
          enabled: true,
          global: { minOfferDiscountPercent: 50, maxDiscountPercent: 10 },
          maxRounds: 1,
          estimatedCostPerAiCallCents: 1
        }),
      (err: unknown) => err instanceof BadRequestException
    );
  });
});
