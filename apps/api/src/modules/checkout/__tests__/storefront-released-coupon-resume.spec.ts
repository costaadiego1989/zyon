import assert from "node:assert/strict";
import test from "node:test";
import { CheckoutBootstrapService } from "../application/services/checkout-bootstrap.service.js";
import { InMemoryCheckoutRepository } from "../infrastructure/repositories/in-memory-checkout.repository.js";
import { checkoutSession, startCheckoutRequest } from "./checkout-test-fixtures.js";
import type { CheckoutCommercialMutation } from "../domain/ports/checkout-session.repository.port.js";

function fixture(released: boolean) {
  class Repository extends InMemoryCheckoutRepository {
    reads = 0;
    forwarded: CheckoutCommercialMutation[] = [];
    hasReleasedStorefrontCouponBinding() { this.reads++; return released; }
    override async commitCommercialMutation(input: CheckoutCommercialMutation) {
      // Forwarding seam only; native dedicated lifecycle must prove ownership,
      // receipt, resolved payments and CAS. This fake grants none of those.
      this.forwarded.push(structuredClone(input)); this.saveSession(input.next); return input.next;
    }
  }
  const repository = new Repository();
  const stored = checkoutSession({ cart: { currency: "BRL", source: "storefront", cart_ref: "cart_1", total: 100, currentDiscount: 0,
    items: [{ sku: "SKU", name: "Synthetic", quantity: 1, price: 100 }] }, customer: { email: "buyer@example.invalid", email_verified: true } });
  repository.saveSession(stored);
  const cart = { ...stored.cart, currentDiscount: 10,
    commercialNudge: { kind: "coupon" as const, title: "Cupom aplicado", message: "Synthetic", couponCode: "SAVE10" } };
  return { repository, bootstrap: new CheckoutBootstrapService(repository, repository),
    input: startCheckoutRequest({ session_id: "chk_1", cart, customer: stored.customer }),
    identity: { requireBuyerProof: true, trustedBuyer: { globalUserId: "usr_1", customer: { email: "buyer@example.invalid", email_verified: true as const } } } };
}

test("ordinary authenticated remount refreshes a released checkout with new server coupon D through the dedicated command", async () => {
  const f = fixture(true); const result = await f.bootstrap.bootstrap(f.input, "usr_1", true, f.identity);
  assert.equal(f.repository.reads, 1); assert.equal(f.repository.forwarded.length, 1);
  assert.equal(f.repository.forwarded[0].expected.cart.currentDiscount, 0);
  assert.equal(f.repository.forwarded[0].next.cart.currentDiscount, 10);
  assert.equal(result.session.cart.commercialNudge?.couponCode, "SAVE10");
});

test("explicit recovery of a released checkout does not replace fresh server coupon D with released zero", async () => {
  const f = fixture(true); const result = await f.bootstrap.bootstrap(f.input, "usr_1", true, { ...f.identity, refreshCart: true });
  assert.equal(f.repository.forwarded[0].next.cart.currentDiscount, 10); assert.equal(result.session.cart.currentDiscount, 10);
});

test("active or unbound checkout does not auto-refresh or acquire a fresh coupon from a remount", async () => {
  const f = fixture(false); const result = await f.bootstrap.bootstrap(f.input, "usr_1", true, f.identity);
  assert.equal(f.repository.reads, 1); assert.equal(f.repository.forwarded.length, 0); assert.equal(result.session.cart.currentDiscount, 0);
});

test("wrong buyer proof is rejected before inspecting release state or invoking its command", async () => {
  const f = fixture(true);
  await assert.rejects(f.bootstrap.bootstrap(f.input, "usr_other", true, { ...f.identity,
    trustedBuyer: { ...f.identity.trustedBuyer, globalUserId: "usr_other" } }), /checkout_buyer_session_binding_mismatch/);
  assert.equal(f.repository.reads, 0); assert.equal(f.repository.forwarded.length, 0);
});
