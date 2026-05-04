import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EvaluateNegotiationUseCase } from "./evaluate-negotiation.use-case.js";

describe("EvaluateNegotiationUseCase", () => {
  it("evaluates item/category/global policy through the deterministic engine", () => {
    const result = new EvaluateNegotiationUseCase().execute({
      merchantId: "mrc_1",
      globalUserId: "usr_global_1",
      cart: {
        total: 200,
        items: [
          { sku: "sku_special", categoryId: "cat_default", price: 100, quantity: 1 },
          { sku: "sku_regular", categoryId: "cat_promo", price: 100, quantity: 1 }
        ]
      },
      merchantPolicy: {
        enabled: true,
        global: { minOfferDiscountPercent: 2, maxDiscountPercent: 6 },
        categories: [{ categoryId: "cat_promo", minOfferDiscountPercent: 5, maxDiscountPercent: 10 }],
        items: [{ sku: "sku_special", minOfferDiscountPercent: 7, maxDiscountPercent: 12 }],
        maxRounds: 3,
        estimatedCostPerAiCallCents: 4
      },
      buyerPreferences: {
        enabled: true,
        targetDiscountPercent: 15,
        minimumAcceptableDiscountPercent: 8,
        maxRounds: 2,
        autoAccept: true
      }
    });

    assert.equal(result.agreement, true);
    assert.equal(result.selectedDiscountPercent, 8);
    assert.equal(result.selectedScope, "item");
    assert.deepEqual(result.selectedPolicyKeys, ["sku_special", "cat_promo"]);
    assert.equal(result.estimatedAiCalls, 4);
  });

  it("denies negotiation when buyer or merchant AI cost cap would be exceeded", () => {
    const result = new EvaluateNegotiationUseCase().execute({
      merchantId: "mrc_1",
      cart: {
        total: 100,
        items: [{ sku: "sku_1", categoryId: "cat_1", price: 100, quantity: 1 }]
      },
      merchantPolicy: {
        enabled: true,
        global: { minOfferDiscountPercent: 5, maxDiscountPercent: 10 },
        maxRounds: 4,
        maxAiCostCents: 10,
        estimatedCostPerAiCallCents: 3
      },
      buyerPreferences: {
        enabled: true,
        targetDiscountPercent: 8,
        minimumAcceptableDiscountPercent: 6,
        maxRounds: 4,
        autoAccept: false
      }
    });

    assert.equal(result.agreement, false);
    assert.equal(result.denialReason, "ai_cost_cap_exceeded");
  });
});
