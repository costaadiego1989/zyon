import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { EmbedCheckoutController, EmbedCheckoutGuardHelper } from "./embed-checkout.controller.js";
import { EmbedTokenService } from "../../domain/embed-token.service.js";
import { embedCheckoutSessionId } from "../../domain/embed-checkout-session.js";
import { InMemoryCheckoutRepository } from "../../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { checkoutSession } from "../../../checkout/__tests__/checkout-test-fixtures.js";

async function fixture(storefront = true, cartRef = "cart_trusted") {
  const tokens = new EmbedTokenService({ value: Buffer.from("coupon-payment-test-secret-32-chars") });
  const now = Math.floor(Date.now() / 1000);
  const claims = tokens.verify(tokens.sign({ typ: "aacp_embed_v1", merchantId: "mrc_1",
    nonce: randomUUID(), issuedAtUnix: now, expiresAtUnix: now + 300,
    ...(storefront ? { storefrontCartRef: "cart_trusted" } : {}) }));
  const repo = new InMemoryCheckoutRepository(), sessionId = embedCheckoutSessionId(claims);
  await repo.saveSession(checkoutSession({ sessionId, globalUserId: "canonical_buyer",
    cart: { currency: "BRL", total: 10, currentDiscount: 1, cart_ref: cartRef,
      items: [{ sku: "item", name: "Item", price: 10, quantity: 1 }] },
    customer: { fullName: "Synthetic Buyer", email: "buyer@example.test", email_verified: true,
      phone: "11999999999", cpf: "52998224725" } }));
  const calls: Array<{ input: unknown; context: unknown }> = [];
  const payments = { async execute(input: unknown, context: unknown) {
    calls.push(structuredClone({ input, context })); return { id: "synthetic_payment", status: "pending" };
  } };
  const controller = new EmbedCheckoutController(undefined as never, undefined as never, undefined as never,
    new EmbedCheckoutGuardHelper(repo), undefined as never, payments as never, undefined as never,
    undefined as never, undefined as never, undefined as never, undefined as never);
  return { claims, repo, sessionId, calls, controller };
}

test("embed forwards verified cart claim and canonical buyer outside the public payment DTO", async () => {
  const f = await fixture();
  await f.controller.intentFromEmbed({ embedClaims: f.claims }, { session_id: f.sessionId, idempotency_key: "key", method: "pix" });
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].context, { marketplaceSurface: "embed", storefrontCouponScope: {
    merchantId: "mrc_1", checkoutSessionId: f.sessionId, cartId: "cart_trusted", buyerId: "canonical_buyer",
  } });
  assert.equal(Object.hasOwn(f.calls[0].input as object, "storefrontCouponScope"), false);
});

test("non-storefront embed retains legacy context without discovering a source by cart_ref", async () => {
  const f = await fixture(false);
  await f.controller.intentFromEmbed({ embedClaims: f.claims }, { session_id: f.sessionId, idempotency_key: "key" });
  assert.deepEqual(f.calls[0].context, { marketplaceSurface: "embed" });
});

test("claim/cart mismatch cannot reach payment creation", async () => {
  const f = await fixture(true, "foreign_cart");
  await assert.rejects(f.controller.intentFromEmbed({ embedClaims: f.claims }, { session_id: f.sessionId, idempotency_key: "key" }), /payment_coupon_authority_conflict/);
  assert.equal(f.calls.length, 0);
});

for (const field of ["storefrontCouponScope", "couponAuthority", "coupon_authority", "_storefrontCouponBinding"]) {
  test(`public payment body cannot inject private ${field}`, async () => {
    const f = await fixture();
    await assert.rejects(f.controller.intentFromEmbed({ embedClaims: f.claims }, {
      session_id: f.sessionId, idempotency_key: "key", [field]: { buyerId: "foreign" },
    }), /payment_coupon_authority_conflict/);
    assert.equal(f.calls.length, 0);
  });
}
