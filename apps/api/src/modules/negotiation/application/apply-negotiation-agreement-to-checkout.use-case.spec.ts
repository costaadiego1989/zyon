import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { ApplyNegotiationAgreementToCheckoutUseCase } from "./apply-negotiation-agreement-to-checkout.use-case.js";
import { InMemoryNegotiationStore } from "../infrastructure/in-memory-negotiation.store.js";
import { InMemoryCheckoutRepository } from "../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { checkoutSession } from "../../checkout/__tests__/checkout-test-fixtures.js";
import { negotiateDiscount } from "@aacp/negotiation-engine";
import { negotiationCartFingerprint } from "../domain/cart-fingerprint.js";
import type { NegotiationResult } from "@aacp/negotiation-engine";

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

    const uc = new ApplyNegotiationAgreementToCheckoutUseCase(store, checkout);

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

    const uc = new ApplyNegotiationAgreementToCheckoutUseCase(store, checkout);

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
});
