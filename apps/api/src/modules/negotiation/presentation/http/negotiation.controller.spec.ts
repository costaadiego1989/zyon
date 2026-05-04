import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NegotiationController } from "./negotiation.controller.js";
import {
  EvaluateNegotiationUseCase,
  type EvaluateNegotiationInput
} from "../../application/evaluate-negotiation.use-case.js";
import type { GetMerchantNegotiationPolicyUseCase } from "../../application/merchant-negotiation-policy.use-cases.js";
import type { GetBuyerAgentPreferencesUseCase } from "../../application/buyer-agent-preferences.use-cases.js";
import type { RecordNegotiationSessionUseCase } from "../../application/record-negotiation-session.use-case.js";

class RecordingEvaluateNegotiationUseCase extends EvaluateNegotiationUseCase {
  public received?: EvaluateNegotiationInput;

  override execute(input: EvaluateNegotiationInput) {
    this.received = input;
    return super.execute(input);
  }
}

describe("NegotiationController", () => {
  it("uses authenticated merchant scope instead of trusting body merchant ids", async () => {
    const useCase = new RecordingEvaluateNegotiationUseCase();

    let resolvedMerchantCalls = 0;
    let resolvedBuyerCalls = 0;
    let recorded: unknown;

    const getMerchantPolicy = {
      executeResolved() {
        resolvedMerchantCalls += 1;
        return Promise.resolve({
          enabled: true,
          global: { minOfferDiscountPercent: 5, maxDiscountPercent: 10 },
          maxRounds: 2,
          estimatedCostPerAiCallCents: 1
        });
      }
    };

    const getBuyerPreferences = {
      executeResolved() {
        resolvedBuyerCalls += 1;
        return Promise.resolve({
          enabled: true,
          targetDiscountPercent: 12,
          minimumAcceptableDiscountPercent: 7,
          maxRounds: 2,
          autoAccept: true
        });
      }
    };

    const recordSession = {
      execute(input: unknown) {
        recorded = input;
        return Promise.resolve({ negotiation_session_id: "ns_test" });
      }
    };

    const controller = new NegotiationController(
      useCase,
      getMerchantPolicy as unknown as GetMerchantNegotiationPolicyUseCase,
      getBuyerPreferences as unknown as GetBuyerAgentPreferencesUseCase,
      recordSession as unknown as RecordNegotiationSessionUseCase,
      {} as never
    );

    const result = await controller.evaluate(
      { user: { userId: "usr_owner", merchantId: "mrc_auth", email: "owner@example.com", role: "owner" } },
      {
        merchantId: "mrc_body",
        merchant_id: "mrc_snake_body",
        globalUserId: "usr_global_1",
        cart: {
          total: 100,
          items: [{ sku: "sku_1", categoryId: "cat_1", price: 100, quantity: 1 }]
        },
        merchantPolicy: {
          enabled: true,
          global: { minOfferDiscountPercent: 5, maxDiscountPercent: 10 },
          maxRounds: 2,
          estimatedCostPerAiCallCents: 1
        },
        buyerPreferences: {
          enabled: true,
          targetDiscountPercent: 12,
          minimumAcceptableDiscountPercent: 7,
          maxRounds: 2,
          autoAccept: true
        }
      }
    );

    assert.equal(useCase.received?.merchantId, "mrc_auth");
    assert.equal(result.agreement, true);
    assert.equal(result.selectedDiscountPercent, 7);
    assert.equal(result.negotiation_session_id, "ns_test");
    assert.equal(resolvedMerchantCalls, 0);
    assert.equal(resolvedBuyerCalls, 0);
    assert.equal((recorded as { merchantId: string }).merchantId, "mrc_auth");
  });

  it("loads persisted negotiation policies when omitted from evaluate body", async () => {
    const useCase = new RecordingEvaluateNegotiationUseCase();
    let resolvedMerchantCalls = 0;

    const getMerchantPolicy = {
      executeResolved(merchantId: string) {
        resolvedMerchantCalls += 1;
        assert.equal(merchantId, "mrc_auth");
        return Promise.resolve({
          enabled: true,
          global: { minOfferDiscountPercent: 5, maxDiscountPercent: 10 },
          maxRounds: 2,
          estimatedCostPerAiCallCents: 1
        });
      }
    };

    const getBuyerPreferences = {
      executeResolved() {
        return Promise.resolve({
          enabled: true,
          targetDiscountPercent: 12,
          minimumAcceptableDiscountPercent: 7,
          maxRounds: 2,
          autoAccept: true
        });
      }
    };

    const recordSession = {
      execute() {
        return Promise.resolve({ negotiation_session_id: "ns_from_store" });
      }
    };

    const controller = new NegotiationController(
      useCase,
      getMerchantPolicy as unknown as GetMerchantNegotiationPolicyUseCase,
      getBuyerPreferences as unknown as GetBuyerAgentPreferencesUseCase,
      recordSession as unknown as RecordNegotiationSessionUseCase,
      {} as never
    );

    const result = await controller.evaluate(
      { user: { userId: "u", merchantId: "mrc_auth", email: "e", role: "owner" } },
      {
        globalUserId: "g1",
        cart: {
          total: 100,
          items: [{ sku: "sku_1", categoryId: "cat_1", price: 100, quantity: 1 }]
        }
      }
    );

    assert.equal(resolvedMerchantCalls, 1);
    assert.equal(result.agreement, true);
    assert.equal(result.negotiation_session_id, "ns_from_store");
  });
});
