/**
 * Regression tests for ADR-0001 (checkout core hardening) fixes.
 * Each test is named to reference the ADR item it covers.
 * Tests must FAIL on the old code and PASS on the fixed code.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BadRequestException, NotFoundException } from "@nestjs/common";

import { InMemoryCheckoutRepository } from "../../infrastructure/repositories/in-memory-checkout.repository.js";
import { AcceptCheckoutOfferUseCase } from "./accept-checkout-offer.use-case.js";
import { ApplyOfferUseCase } from "./apply-offer.use-case.js";
import { CompleteOrderUseCase } from "./complete-order.use-case.js";
import { EvaluateShippingUseCase } from "./evaluate-shipping.use-case.js";
import { UpdateCartUseCase } from "./update-cart.use-case.js";
import { checkoutSession, authorizedOffer, testCart } from "../../__tests__/checkout-test-fixtures.js";
import type { AuthorizedOffer } from "@aacp/shared-types";
import type { CommerceOfferPort } from "../../domain/ports/commerce-offer.port.js";

class FakeCommerce implements CommerceOfferPort {
  async apply(offer: AuthorizedOffer) {
    return { success: true as const, discount_code: offer.discountCode, apply_url: "https://example.com/discount" };
  }
}

// ─── P1: cross-session offer reuse ───────────────────────────────────────────

describe("P1 — cross-session offer must be rejected in apply-offer", () => {
  it("rejects offer belonging to a different session", async () => {
    const repo = new InMemoryCheckoutRepository();
    // Two sessions for same merchant
    repo.saveSession(checkoutSession({ sessionId: "sess_A" }));
    repo.saveSession(checkoutSession({ sessionId: "sess_B" }));
    // Offer is for sess_A
    const offer = authorizedOffer({ id: "off_1", sessionId: "sess_A", merchantId: "mrc_1" });
    repo.saveOffer(offer);
    const acceptOffer = new AcceptCheckoutOfferUseCase(repo, repo, repo);
    const useCase = new ApplyOfferUseCase(repo, repo, new FakeCommerce(), acceptOffer);

    // Attempt to apply sess_A's offer to sess_B
    const result = await useCase.execute({ merchant_id: "mrc_1", session_id: "sess_B", offer_id: "off_1" });
    assert.equal(result.success, false);
    assert.equal((result as { reason?: string }).reason, "offer_not_found_or_not_approved");
  });

  it("accepts offer belonging to the correct session", async () => {
    const repo = new InMemoryCheckoutRepository();
    repo.saveSession(checkoutSession({ sessionId: "sess_A" }));
    const offer = authorizedOffer({ id: "off_2", sessionId: "sess_A", merchantId: "mrc_1" });
    repo.saveOffer(offer);
    const acceptOffer = new AcceptCheckoutOfferUseCase(repo, repo, repo);
    const useCase = new ApplyOfferUseCase(repo, repo, new FakeCommerce(), acceptOffer);

    const result = await useCase.execute({ merchant_id: "mrc_1", session_id: "sess_A", offer_id: "off_2" });
    assert.equal(result.success, true);
  });
});

describe("P1 — cross-session offer must be rejected in accept-checkout-offer", () => {
  it("throws NotFoundException when offer belongs to a different session", async () => {
    const repo = new InMemoryCheckoutRepository();
    repo.saveSession(checkoutSession({ sessionId: "sess_A" }));
    repo.saveSession(checkoutSession({ sessionId: "sess_B" }));
    const offer = authorizedOffer({ id: "off_3", sessionId: "sess_A", merchantId: "mrc_1" });
    repo.saveOffer(offer);
    const useCase = new AcceptCheckoutOfferUseCase(repo, repo, repo);

    await assert.rejects(
      () => useCase.execute({ merchant_id: "mrc_1", session_id: "sess_B", offer_id: "off_3" }),
      NotFoundException
    );
  });
});

// ─── P1: cart.total is gross (no double discount subtraction) ─────────────────

describe("P1 — cart.total is always gross after update-cart", () => {
  it("stores gross total (no discount embedded) so experience does not double-subtract", async () => {
    const repo = new InMemoryCheckoutRepository();
    const session = checkoutSession({
      cart: testCart({
        total: 200,
        currentDiscount: 20,
        items: [{ sku: "x", name: "X", price: 200, cost: 80, quantity: 1 }]
      })
    });
    repo.saveSession(session);
    const useCase = new UpdateCartUseCase(repo, repo);

    // Simulate a no-op update (same quantity) — total should stay gross
    const res = await useCase.execute({ merchant_id: "mrc_1", session_id: "chk_1", items: [{ sku: "x", quantity: 1 }] });

    const updated = repo.getSession("mrc_1", "chk_1");
    // cart.total must be gross (200), discount is separate
    assert.equal(updated?.cart.total, 200, "cart.total should be gross (200), not net (180)");
    assert.equal(updated?.cart.currentDiscount, 20, "discount should be unchanged");
    // experience.totals.total = 200 + 0 (no shipping) - 20 = 180
    assert.equal(res.experience.totals.total, 180, "displayed total should be net");
    assert.equal(res.experience.totals.discount, 20, "discount shown separately");
  });
});

// ─── P1: complete-order recomputes server-side total ─────────────────────────

describe("P1 — complete-order validates order_total server-side when offerRepository is wired", () => {
  it("rejects tampered order_total when offerRepository is present", async () => {
    const repo = new InMemoryCheckoutRepository();
    // Session with no shipping, no discount → expected total = 300
    repo.saveSession(checkoutSession({ shipping: undefined }));

    // Wire offerRepository to enable validation
    const useCase = new CompleteOrderUseCase(repo, repo, repo, repo /* offerRepository */);

    await assert.rejects(
      () => useCase.execute({
        merchant_id: "mrc_1",
        session_id: "chk_1",
        external_order_id: "ord_bad",
        order_total: 1, // tampered
        currency: "BRL"
      }),
      BadRequestException
    );
  });

  it("accepts correct order_total (gross cart + shipping - discount)", async () => {
    const repo = new InMemoryCheckoutRepository();
    repo.saveSession(checkoutSession({
      shipping: { customerPrice: 15, realCost: 18, region: "SP" },
      cart: testCart({ total: 300, currentDiscount: 0, items: [{ sku: "p", name: "P", price: 300, cost: 100, quantity: 1 }] })
    }));
    const useCase = new CompleteOrderUseCase(repo, repo, repo, repo);

    // expected = 300 + 15 - 0 = 315
    const result = await useCase.execute({
      merchant_id: "mrc_1",
      session_id: "chk_1",
      external_order_id: "ord_ok",
      order_total: 315,
      currency: "BRL"
    });
    assert.equal(result.recorded, true);
  });

  it("rejects accepted_offer_id that was not actually accepted for this session", async () => {
    const repo = new InMemoryCheckoutRepository();
    repo.saveSession(checkoutSession({ shipping: undefined }));
    const useCase = new CompleteOrderUseCase(repo, repo, repo, repo);

    await assert.rejects(
      () => useCase.execute({
        merchant_id: "mrc_1",
        session_id: "chk_1",
        external_order_id: "ord_x",
        order_total: 300,
        currency: "BRL",
        accepted_offer_id: "non_existent_offer_id"
      }),
      BadRequestException
    );
  });
});

// ─── P3: discount code is not derived from session id ─────────────────────────

describe("P3 — offer discount code uses CSPRNG (not session id prefix)", () => {
  it("discount code does not start with session id prefix", async () => {
    const repo = new InMemoryCheckoutRepository();
    repo.saveSession(checkoutSession({ sessionId: "chk_ABCDEF_test" }));
    const useCase = new EvaluateShippingUseCase(repo, repo, repo);

    const res = await useCase.execute({
      merchant_id: "mrc_1",
      session_id: "chk_ABCDEF_test",
      shipping_price: 0,
      shipping_real_cost: 35
    });

    if (res.offer?.discountCode) {
      // Old code: `AI-CHK_AB` (first 6 chars of sessionId)
      // New code: `AI-` followed by random hex, NOT the session prefix
      assert.ok(
        !res.offer.discountCode.startsWith("AI-CHK_AB"),
        `Discount code '${res.offer.discountCode}' must not be derived from session id prefix`
      );
    }
    // Code should still start with the AI- prefix
    if (res.offer?.discountCode) {
      assert.ok(res.offer.discountCode.startsWith("AI-"), "Discount code should start with AI-");
    }
  });

  it("two offers for different sessions have different discount codes", async () => {
    const repo = new InMemoryCheckoutRepository();
    repo.saveSession(checkoutSession({ sessionId: "chk_AA1111" }));
    repo.saveSession(checkoutSession({ sessionId: "chk_AA2222" }));

    const useCase = new EvaluateShippingUseCase(repo, repo, repo);
    const r1 = await useCase.execute({ merchant_id: "mrc_1", session_id: "chk_AA1111", shipping_price: 0, shipping_real_cost: 35 });
    const r2 = await useCase.execute({ merchant_id: "mrc_1", session_id: "chk_AA2222", shipping_price: 0, shipping_real_cost: 35 });

    if (r1.offer?.discountCode && r2.offer?.discountCode) {
      assert.notEqual(r1.offer.discountCode, r2.offer.discountCode, "Discount codes should differ (CSPRNG)");
    }
  });
});
