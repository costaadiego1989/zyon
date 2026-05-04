import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertValidBuyerNegotiationPreferences } from "./buyer-agent-preferences.entity.js";

describe("assertValidBuyerNegotiationPreferences", () => {
  it("accepts valid prefs", () => {
    assert.doesNotThrow(() =>
      assertValidBuyerNegotiationPreferences({
        enabled: true,
        targetDiscountPercent: 10,
        minimumAcceptableDiscountPercent: 5,
        maxRounds: 2,
        autoAccept: true
      })
    );
  });

  it("rejects negative target", () => {
    assert.throws(
      () =>
        assertValidBuyerNegotiationPreferences({
          enabled: true,
          targetDiscountPercent: -1,
          minimumAcceptableDiscountPercent: 0,
          maxRounds: 2,
          autoAccept: false
        }),
      /buyer_prefs_invalid_target/
    );
  });
});
