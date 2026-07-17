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
      {} as never,
      {} as never
    );

    const result = await controller.evaluate(
      { user: { userId: "usr_owner", merchantId: "mrc_auth", email: "owner@example.com", role: "owner" } },
      {
        globalUserId: "usr_global_1",
        cart: {
          total: 100,
          items: [{ sku: "sku_1", categoryId: "cat_1", price: 100, quantity: 1 }]
        }
        // Bug 2 fix: merchantPolicy and buyerPreferences in body are no longer accepted —
        // they are always loaded from the authenticated tenant store.
      }
    );

    assert.equal(useCase.received?.merchantId, "mrc_auth");
    assert.equal(result.agreement, true);
    assert.equal(result.selectedDiscountPercent, 7);
    assert.equal((result as { negotiation_session_id?: string }).negotiation_session_id, "ns_test");
    // Bug 2 fix: store is ALWAYS called (1 call each), never trusting body overrides.
    assert.equal(resolvedMerchantCalls, 1);
    assert.equal(resolvedBuyerCalls, 1);
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
      {} as never,
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
    assert.equal((result as { negotiation_session_id?: string }).negotiation_session_id, "ns_from_store");
  });

  // Bug 4 regression: evaluate must NOT create a session when the result is a
  // clean deterministic denial (merchant_machine_negotiation_disabled, etc.) where
  // zero AI calls occurred.
  it("does not record session when negotiation is cleanly denied without AI cost — Bug 4", async () => {
    const useCase = new RecordingEvaluateNegotiationUseCase();
    let sessionRecorded = false;

    const getMerchantPolicy = {
      executeResolved() {
        return Promise.resolve({
          enabled: false, // disabled → instant denial, no AI cost
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
          targetDiscountPercent: 10,
          minimumAcceptableDiscountPercent: 5,
          maxRounds: 2,
          autoAccept: false
        });
      }
    };

    const recordSession = {
      execute() {
        sessionRecorded = true;
        return Promise.resolve({ negotiation_session_id: "ns_should_not_exist" });
      }
    };

    const controller = new NegotiationController(
      useCase,
      getMerchantPolicy as unknown as GetMerchantNegotiationPolicyUseCase,
      getBuyerPreferences as unknown as GetBuyerAgentPreferencesUseCase,
      recordSession as unknown as RecordNegotiationSessionUseCase,
      {} as never,
      {} as never
    );

    const result = await controller.evaluate(
      { user: { userId: "u", merchantId: "mrc_off", email: "e", role: "owner" } },
      { cart: { total: 100, items: [{ sku: "s", categoryId: "c", price: 100, quantity: 1 }] } }
    );

    assert.equal(result.agreement, false);
    assert.equal(result.denialReason, "merchant_machine_negotiation_disabled");
    assert.equal(sessionRecorded, false, "no session must be recorded for a free denial");
    assert.equal((result as Record<string, unknown>)["negotiation_session_id"], undefined);
  });
});
