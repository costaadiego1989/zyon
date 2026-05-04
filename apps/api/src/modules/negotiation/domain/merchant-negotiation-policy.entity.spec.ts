import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
});
