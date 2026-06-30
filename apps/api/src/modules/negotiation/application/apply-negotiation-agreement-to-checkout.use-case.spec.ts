import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { ApplyNegotiationAgreementToCheckoutUseCase } from "./apply-negotiation-agreement-to-checkout.use-case.js";
import { InMemoryNegotiationStore } from "../infrastructure/in-memory-negotiation.store.js";
import { InMemoryCheckoutRepository } from "../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { checkoutSession } from "../../checkout/__tests__/checkout-test-fixtures.js";
import { negotiateDiscount } from "@zyon/negotiation-engine";
import { negotiationCartFingerprint } from "../domain/cart-fingerprint.js";
import type { NegotiationResult } from "@zyon/negotiation-engine";
import { GetMerchantNegotiationPolicyUseCase } from "./merchant-negotiation-policy.use-cases.js";

/** Helper: build a use-case instance with an optional merchant policy override */
function buildUseCase(store: InMemoryNegotiationStore, checkout: InMemoryCheckoutRepository) {
  const getMerchantPolicy = new GetMerchantNegotiationPolicyUseCase(store);
  return new ApplyNegotiationAgreementToCheckoutUseCase(
    store,
    checkout,
    checkout,
    checkout,
    getMerchantPolicy
  );
}

describe("ApplyNegotiationAgreementToCheckoutUseCase", () => {
  it("persists authorized offer when negotiation snapshot matches checkout cart and rules allow", async () => {
    const store = new InMemoryNegotiationStore();
    const checkout = new InMemoryCheckoutRepository();

    const sess = checkoutSession({
      merchantId: "mrc_1",
      sessionId: "sess_1",
      cart: {
        currency: "BRL",
        total: 200,
        items: [{ sku: "a", name: "A", price: 200, quantity: 1, cost: 50 }]
      }
    });
    checkout.saveSession(sess);

    const negCart = { total: 200, items: [{ sku: "a", categoryId: "c", price: 200, quantity: 1 }] };
    const result = negotiateDiscount({
      merchantId: "mrc_1",
      cart: negCart,
      merchantPolicy: {
        enabled: true,
        global: { minOfferDiscountPercent: 2, maxDiscountPercent: 12 },
        maxRounds: 2,
        estimatedCostPerAiCallCents: 1
      },
      buyerPreferences: {
        enabled: true,
        targetDiscountPercent: 10,
        minimumAcceptableDiscountPercent: 5,
        maxRounds: 2,
        autoAccept: true
      }
    });

    assert.equal(result.agreement, true);

    const fp = negotiationCartFingerprint(negCart);
    const { id: negotiationSessionId } = await store.createNegotiationSession({
      merchantId: "mrc_1",
      globalUserId: sess.globalUserId,
      cartFingerprint: fp,
      result
    });
    // Store the merchant policy so GetMerchantNegotiationPolicyUseCase resolves it
    await store.upsertMerchantPolicy("mrc_1", {
      enabled: true,
      global: { minOfferDiscountPercent: 2, maxDiscountPercent: 12 },
      maxRounds: 2,
      estimatedCostPerAiCallCents: 1
    });

    const uc = buildUseCase(store, checkout);

    const out = await uc.execute({
      merchantId: "mrc_1",
      negotiationSessionId,
      checkoutSessionId: "sess_1",
      requestedDiscountPercent: result.selectedDiscountPercent
    });

    assert.equal(out.offer.type, "discount_percent");
    assert.equal(out.offer.value, result.selectedDiscountPercent);
    assert.equal(out.offer.approved, true);
  });

  it("rejects when requested discount does not match negotiation snapshot", async () => {
    const store = new InMemoryNegotiationStore();
    const checkout = new InMemoryCheckoutRepository();

    checkout.saveSession(
      checkoutSession({
        merchantId: "mrc_1",
        sessionId: "sess_x",
        cart: {
          currency: "BRL",
          total: 100,
          items: [{ sku: "a", name: "A", price: 100, quantity: 1, cost: 40 }]
        }
      })
    );
    await store.upsertMerchantPolicy("mrc_1", {
      enabled: true,
      global: { minOfferDiscountPercent: 2, maxDiscountPercent: 10 },
      maxRounds: 2,
      estimatedCostPerAiCallCents: 1
    });

    const negCart = { total: 100, items: [{ sku: "a", price: 100, quantity: 1 }] };
    const snapshot: NegotiationResult = {
      agreement: true,
      selectedDiscountPercent: 5,
      merchantMinOfferDiscountPercent: 2,
      merchantMaxDiscountPercent: 10,
      buyerTargetDiscountPercent: 15,
      buyerMinimumAcceptableDiscountPercent: 5,
      selectedScope: "global",
      selectedPolicyKeys: ["global"],
      maxRounds: 2,
      estimatedAiCalls: 4,
      estimatedAiCostCents: 4,
      autoAccept: true,
      requiresHumanConfirmation: false,
      audit: []
    };

    const { id } = await store.createNegotiationSession({
      merchantId: "mrc_1",
      cartFingerprint: negotiationCartFingerprint(negCart),
      result: snapshot
    });

    const uc = buildUseCase(store, checkout);

    await assert.rejects(
      () =>
        uc.execute({
          merchantId: "mrc_1",
          negotiationSessionId: id,
          checkoutSessionId: "sess_x",
          requestedDiscountPercent: 99
        }),
      (err: unknown) => err instanceof BadRequestException
    );
  });

  // Bug 1 regression: apply must reject when requiresHumanConfirmation is true
  // and humanConfirmed is not explicitly true.
  it("rejects apply when requiresHumanConfirmation=true and human_confirmed not set — Bug 1", async () => {
    const store = new InMemoryNegotiationStore();
    const checkout = new InMemoryCheckoutRepository();

    checkout.saveSession(
      checkoutSession({
        merchantId: "mrc_1",
        sessionId: "sess_hc",
        cart: {
          currency: "BRL",
          total: 500,
          items: [{ sku: "a", name: "A", price: 500, quantity: 1, cost: 100 }]
        }
      })
    );
    await store.upsertMerchantPolicy("mrc_1", {
      enabled: true,
      global: { minOfferDiscountPercent: 2, maxDiscountPercent: 12 },
      maxRounds: 2,
      estimatedCostPerAiCallCents: 1
    });

    const negCart = { total: 500, items: [{ sku: "a", price: 500, quantity: 1 }] };
    // snapshot with requiresHumanConfirmation: true
    const snapshot: NegotiationResult = {
      agreement: true,
      selectedDiscountPercent: 5,
      merchantMinOfferDiscountPercent: 2,
      merchantMaxDiscountPercent: 12,
      buyerTargetDiscountPercent: 10,
      buyerMinimumAcceptableDiscountPercent: 5,
      selectedScope: "global",
      selectedPolicyKeys: ["global"],
      maxRounds: 2,
      estimatedAiCalls: 4,
      estimatedAiCostCents: 4,
      autoAccept: false,
      requiresHumanConfirmation: true,
      audit: []
    };

    const { id } = await store.createNegotiationSession({
      merchantId: "mrc_1",
      cartFingerprint: negotiationCartFingerprint(negCart),
      result: snapshot
    });

    const uc = buildUseCase(store, checkout);

    // Without humanConfirmed → must reject
    await assert.rejects(
      () =>
        uc.execute({
          merchantId: "mrc_1",
          negotiationSessionId: id,
          checkoutSessionId: "sess_hc",
          requestedDiscountPercent: 5
          // humanConfirmed omitted
        }),
      (err: unknown) =>
        err instanceof BadRequestException &&
        (err as BadRequestException).message === "human_confirmation_required"
    );

    // With humanConfirmed: true → must succeed
    await assert.doesNotReject(() =>
      uc.execute({
        merchantId: "mrc_1",
        negotiationSessionId: id,
        checkoutSessionId: "sess_hc",
        requestedDiscountPercent: 5,
        humanConfirmed: true
      })
    );
  });

  // Bug 7 regression: apply must reject when merchant has since disabled negotiation.
  it("rejects apply when merchant policy.enabled is false at apply-time — Bug 7", async () => {
    const store = new InMemoryNegotiationStore();
    const checkout = new InMemoryCheckoutRepository();

    checkout.saveSession(
      checkoutSession({
        merchantId: "mrc_7",
        sessionId: "sess_7",
        cart: {
          currency: "BRL",
          total: 100,
          items: [{ sku: "a", name: "A", price: 100, quantity: 1, cost: 30 }]
        }
      })
    );
    // Policy was enabled when evaluate happened, but now disabled
    await store.upsertMerchantPolicy("mrc_7", {
      enabled: false, // disabled at apply-time
      global: { minOfferDiscountPercent: 2, maxDiscountPercent: 10 },
      maxRounds: 2,
      estimatedCostPerAiCallCents: 1
    });

    const negCart = { total: 100, items: [{ sku: "a", price: 100, quantity: 1 }] };
    const snapshot: NegotiationResult = {
      agreement: true,
      selectedDiscountPercent: 5,
      merchantMinOfferDiscountPercent: 2,
      merchantMaxDiscountPercent: 10,
      buyerTargetDiscountPercent: 10,
      buyerMinimumAcceptableDiscountPercent: 5,
      selectedScope: "global",
      selectedPolicyKeys: ["global"],
      maxRounds: 2,
      estimatedAiCalls: 4,
      estimatedAiCostCents: 4,
      autoAccept: true,
      requiresHumanConfirmation: false,
      audit: []
    };

    const { id } = await store.createNegotiationSession({
      merchantId: "mrc_7",
      cartFingerprint: negotiationCartFingerprint(negCart),
      result: snapshot
    });

    const uc = buildUseCase(store, checkout);

    await assert.rejects(
      () =>
        uc.execute({
          merchantId: "mrc_7",
          negotiationSessionId: id,
          checkoutSessionId: "sess_7",
          requestedDiscountPercent: 5
        }),
      (err: unknown) =>
        err instanceof BadRequestException &&
        (err as BadRequestException).message === "merchant_negotiation_policy_disabled"
    );
  });

  // Bug 3 regression: second identical apply must not create a duplicate offer/ledger.
  it("is idempotent — second apply returns without creating duplicate ledger entry — Bug 3", async () => {
    const store = new InMemoryNegotiationStore();
    const checkout = new InMemoryCheckoutRepository();

    const negCart = { total: 200, items: [{ sku: "a", price: 200, quantity: 1 }] };
    checkout.saveSession(
      checkoutSession({
        merchantId: "mrc_3",
        sessionId: "sess_3",
        cart: {
          currency: "BRL",
          total: 200,
          items: [{ sku: "a", name: "A", price: 200, quantity: 1, cost: 50 }]
        }
      })
    );
    await store.upsertMerchantPolicy("mrc_3", {
      enabled: true,
      global: { minOfferDiscountPercent: 2, maxDiscountPercent: 12 },
      maxRounds: 2,
      estimatedCostPerAiCallCents: 1
    });

    const snapshot: NegotiationResult = {
      agreement: true,
      selectedDiscountPercent: 5,
      merchantMinOfferDiscountPercent: 2,
      merchantMaxDiscountPercent: 12,
      buyerTargetDiscountPercent: 10,
      buyerMinimumAcceptableDiscountPercent: 5,
      selectedScope: "global",
      selectedPolicyKeys: ["global"],
      maxRounds: 2,
      estimatedAiCalls: 4,
      estimatedAiCostCents: 4,
      autoAccept: true,
      requiresHumanConfirmation: false,
      audit: []
    };

    const { id } = await store.createNegotiationSession({
      merchantId: "mrc_3",
      cartFingerprint: negotiationCartFingerprint(negCart),
      result: snapshot
    });

    const uc = buildUseCase(store, checkout);

    await uc.execute({
      merchantId: "mrc_3",
      negotiationSessionId: id,
      checkoutSessionId: "sess_3",
      requestedDiscountPercent: 5
    });

    // Second call — must not throw and must not add another ledger entry
    await uc.execute({
      merchantId: "mrc_3",
      negotiationSessionId: id,
      checkoutSessionId: "sess_3",
      requestedDiscountPercent: 5
    });

    const ledger = store.listLedger().filter(
      (e) => e.negotiationSessionId === id && e.eventType === "negotiation.offer_applied"
    );
    assert.equal(ledger.length, 1, "exactly one offer_applied entry — no duplicate");
  });

  // Bug 10 regression: ledger offer_applied must record non-zero discountPercent.
  it("records actual discount percent in ledger (not 0) — Bug 10", async () => {
    const store = new InMemoryNegotiationStore();
    const checkout = new InMemoryCheckoutRepository();

    checkout.saveSession(
      checkoutSession({
        merchantId: "mrc_10",
        sessionId: "sess_10",
        cart: {
          currency: "BRL",
          total: 100,
          items: [{ sku: "a", name: "A", price: 100, quantity: 1, cost: 30 }]
        }
      })
    );
    await store.upsertMerchantPolicy("mrc_10", {
      enabled: true,
      global: { minOfferDiscountPercent: 2, maxDiscountPercent: 12 },
      maxRounds: 2,
      estimatedCostPerAiCallCents: 1
    });

    const negCart = { total: 100, items: [{ sku: "a", price: 100, quantity: 1 }] };
    const snapshot: NegotiationResult = {
      agreement: true,
      selectedDiscountPercent: 7,
      merchantMinOfferDiscountPercent: 2,
      merchantMaxDiscountPercent: 12,
      buyerTargetDiscountPercent: 10,
      buyerMinimumAcceptableDiscountPercent: 5,
      selectedScope: "global",
      selectedPolicyKeys: ["global"],
      maxRounds: 2,
      estimatedAiCalls: 4,
      estimatedAiCostCents: 4,
      autoAccept: true,
      requiresHumanConfirmation: false,
      audit: []
    };

    const { id } = await store.createNegotiationSession({
      merchantId: "mrc_10",
      cartFingerprint: negotiationCartFingerprint(negCart),
      result: snapshot
    });

    const uc = buildUseCase(store, checkout);
    await uc.execute({
      merchantId: "mrc_10",
      negotiationSessionId: id,
      checkoutSessionId: "sess_10",
      requestedDiscountPercent: 7
    });

    const entry = store.listLedger().find(
      (e) => e.negotiationSessionId === id && e.eventType === "negotiation.offer_applied"
    );
    assert.ok(entry, "ledger entry for offer_applied must exist");
    // amountCents encodes discountPercent * 100 = 700
    assert.equal(entry!.amountCents, 700, "ledger must record actual discount, not 0");
  });
});
