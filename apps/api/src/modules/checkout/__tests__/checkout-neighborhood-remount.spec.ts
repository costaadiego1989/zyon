import test from "node:test";
import assert from "node:assert/strict";
import { ConflictException } from "@nestjs/common";
import type { StartCheckoutRequest } from "@zyon/shared-types";
import { CheckoutBootstrapService } from "../application/services/checkout-bootstrap.service.js";
import type { QuoteShippingUseCase } from "../../shipping/application/use-cases/quote-shipping.use-case.js";
import { InMemoryCheckoutRepository } from "../infrastructure/repositories/in-memory-checkout.repository.js";
import { checkoutSession } from "./checkout-test-fixtures.js";

// Application ordering doubles only. Actual locality/config/quote matching is
// covered by the shipping domain tests; this is not database/HTTP proof.
function fixture(refuse = false) {
  const repo = new InMemoryCheckoutRepository(), calls: string[] = [];
  const initial = checkoutSession({
    merchantId: "merchant-locality", sessionId: "checkout-locality", globalUserId: "buyer-locality",
    cart: { currency: "BRL", source: "storefront", total: 90, currentDiscount: 0,
      items: [{ sku: "sku-locality", name: "Produto", price: 90, originalPrice: 100, quantity: 1 }] },
    customer: { email: "locality@example.test", email_verified: true, address_verified: true,
      address: { zip: "09010000", city: "Santo Andre", state: "SP", neighborhood: "Centro" } },
    shipping: { carrier: "own_delivery_neighborhood_centro", method: "Entrega própria - Centro",
      customerPrice: 9, realCost: 9, deliveryDays: 2, destinationZip: "09010000" },
  });
  repo.saveSession(initial);
  const save = repo.saveSession.bind(repo);
  repo.saveSession = session => { calls.push("save"); save(session); };
  const quotes = { async assertNeighborhoodDestination(session: typeof initial) {
    calls.push("city-guard"); assert.equal(session.sessionId, initial.sessionId);
    if (refuse) throw new ConflictException("neighborhood_destination_outside_origin_city");
  } } as unknown as QuoteShippingUseCase;
  const bootstrap = new CheckoutBootstrapService(repo, repo, undefined, undefined, undefined, undefined, undefined, quotes);
  const input: StartCheckoutRequest = { merchant_id: initial.merchantId, session_id: initial.sessionId,
    cart: structuredClone(initial.cart) };
  return { repo, calls, bootstrap, initial, input };
}

test("remount revalidates selected shipping before saving or rendering, preserving all quoted money", async () => {
  const f = fixture();
  const result = await f.bootstrap.bootstrap(f.input, f.initial.globalUserId, true);
  assert.deepEqual(f.calls, ["city-guard", "save"]);
  assert.deepEqual(result.session.cart, f.initial.cart);
  assert.deepEqual(result.session.shipping, f.initial.shipping);
});

test("outside-city remount refuses before writing without clearing or repricing the existing selection", async () => {
  const f = fixture(true), before = structuredClone(f.repo.getSession(f.initial.merchantId, f.initial.sessionId));
  await assert.rejects(f.bootstrap.bootstrap(f.input, f.initial.globalUserId, true), /neighborhood_destination_outside_origin_city/);
  assert.deepEqual(f.calls, ["city-guard"]);
  assert.deepEqual(f.repo.getSession(f.initial.merchantId, f.initial.sessionId), before);
  assert.equal(f.repo.listOutbox(f.initial.merchantId).length, 0);
});

test("buyer binding refusal precedes shipping lookup and all remount writes", async () => {
  const f = fixture();
  await assert.rejects(f.bootstrap.bootstrap(f.input, f.initial.globalUserId, true, { requireBuyerProof: true }), /checkout_buyer_proof_required/);
  assert.deepEqual(f.calls, []);
});

test("explicit recovery refresh requires new shipping and never resurrects a prior neighborhood selection", async () => {
  const f = fixture(true);
  const result = await f.bootstrap.bootstrap(f.input, f.initial.globalUserId, true, { refreshCart: true });
  assert.equal(f.calls.includes("city-guard"), false);
  assert.equal(result.session.shipping, undefined);
  assert.equal(result.session.shippingOptions, undefined);
  assert.deepEqual(result.session.cart, f.initial.cart);
});
