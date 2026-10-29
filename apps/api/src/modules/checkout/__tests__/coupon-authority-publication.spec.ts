import assert from "node:assert/strict";
import test from "node:test";
import { CompleteOrderUseCase } from "../application/use-cases/complete-order.use-case.js";
import { InMemoryCheckoutRepository } from "../infrastructure/repositories/in-memory-checkout.repository.js";
import type { PersistedPaymentApproval } from "../domain/ports/payment-approval.port.js";
import { checkoutSession, completeOrderRequest } from "./checkout-test-fixtures.js";
import { paymentCartFingerprint } from "../domain/services/payment-cart-fingerprint.js";
import { PrismaCheckoutRepository } from "../infrastructure/prisma/prisma-checkout.repository.js";
import type { Prisma } from "@prisma/client";

const identity = { version: 1 as const, bindingId: "11111111-1111-4111-8111-111111111111", merchantId: "mrc_1",
  cartId: "cart_1", checkoutSessionId: "chk_1", buyerId: "usr_1", reservationBuyerId: null,
  redemptionId: "redemption_1", couponId: "coupon_1", discountCents: 1000, basisHash: "a".repeat(64) };

function setup(transaction = true) {
  class TrustedOrderSessions extends InMemoryCheckoutRepository {
    async assertCouponOrderAuthority(merchantId: string, sessionId: string, authority?: unknown) {
      assert.equal(merchantId, "mrc_1"); assert.equal(sessionId, "chk_1");
      if (authority !== undefined) assert.deepEqual(authority, { ...identity, orderId: "ord_1" });
    }
  }
  const repository = new TrustedOrderSessions();
  const session = checkoutSession();
  session.cart = { ...session.cart, source: "storefront", cart_ref: "cart_1", currentDiscount: 10 };
  repository.saveSession(session);
  const approval: PersistedPaymentApproval = { id: "intent_1", merchantId: "mrc_1", sessionId: "chk_1", status: "approved",
    currency: "BRL", amountCents: 34000, approvedAmountCents: 34000, providerPaymentId: "ord_1", acceptedOfferId: null,
    amountBreakdown: { version: 1, currency: "BRL", itemsSubtotalCents: 30000, discountCents: 1000,
      shippingCents: 3500, platformFeeCents: 1500, totalCents: 34000, cartFingerprint: paymentCartFingerprint(session) },
    couponAuthority: structuredClone(identity) };
  const useCase = new CompleteOrderUseCase(repository, repository, repository, repository,
    undefined, undefined, undefined, transaction ? repository : undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, { find: async () => approval });
  return { repository, approval, useCase, request: completeOrderRequest({ order_total: 325 }) };
}

test("approved coupon authority is frozen with provider orderId in the order/outbox commit, including buyer fee", async () => {
  const f = setup();
  assert.equal((await f.useCase.executePaymentApproval(f.request, f.approval.id)).idempotent, false);
  const events = f.repository.listOutbox("mrc_1").filter(e => e.event_type === "order.completed");
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].payload.coupon_authority, { ...identity, orderId: "ord_1" });
  assert.equal(events[0].payload.payment_intent_id, f.approval.id);
  assert.equal(f.repository.getCompletedOrder("mrc_1", "chk_1", "ord_1")?.orderTotal, 325);
  f.approval.couponAuthority!.bindingId = "22222222-2222-4222-8222-222222222222";
  assert.deepEqual(events[0].payload.coupon_authority, { ...identity, orderId: "ord_1" }, "journal result must not alias durable payload");
});

test("approved coupon replay does not rederive authority from an edited live cart or republish", async () => {
  const f = setup();
  await f.useCase.executePaymentApproval(f.request, f.approval.id);
  f.repository.saveSession(checkoutSession({ cart: { currency: "BRL", total: 1, items: [] } }));
  assert.equal((await f.useCase.executePaymentApproval(f.request, f.approval.id)).idempotent, true);
  assert.equal(f.repository.listOutbox("mrc_1").filter(e => e.event_type === "order.completed").length, 1);
  assert.deepEqual(f.repository.listOutbox("mrc_1")[0].payload.coupon_authority, { ...identity, orderId: "ord_1" });
});

test("bound completion refuses non-transactional order/outbox fallback before writes", async () => {
  const f = setup(false);
  await assert.rejects(f.useCase.executePaymentApproval(f.request, f.approval.id), /checkout_coupon_binding_conflict/);
  assert.equal(f.repository.getCompletedOrder("mrc_1", "chk_1", "ord_1"), undefined);
  assert.equal(f.repository.listOutbox("mrc_1").length, 0);
});

for (const [name, value] of Object.entries({ null: null, undefined: undefined, extra: { ...identity, untrusted: true },
  wrongTenant: { ...identity, merchantId: "foreign" }, wrongCheckout: { ...identity, checkoutSessionId: "foreign" },
  wrongBuyer: { ...identity, buyerId: "other" }, wrongDiscount: { ...identity, discountCents: 1001 } })) {
  test("publisher rejects present invalid or inconsistent coupon authority: " + name, async () => {
    const f = setup();
    Object.assign(f.approval, { couponAuthority: value });
    await assert.rejects(f.useCase.executePaymentApproval(f.request, f.approval.id), /checkout_coupon_binding_conflict/);
    assert.equal(f.repository.getCompletedOrder("mrc_1", "chk_1", "ord_1"), undefined);
    assert.equal(f.repository.listOutbox("mrc_1").length, 0);
  });
}

test("legacy approval omits authority; HTTP body cannot inject it", async () => {
  const f = setup();
  delete f.approval.couponAuthority;
  await f.useCase.executePaymentApproval({ ...f.request, coupon_authority: identity, couponAuthority: identity } as typeof f.request, f.approval.id);
  const event = f.repository.listOutbox("mrc_1").find(e => e.event_type === "order.completed")!;
  assert.equal(Object.hasOwn(event.payload, "coupon_authority"), false);
});

for (const transaction of [true, false]) test("public completion checks canonical bound storage before order/outbox writes (transaction=" + transaction + ")", async () => {
  class BoundSessions extends InMemoryCheckoutRepository {
    checks = 0;
    async assertPublicCompletionAllowed(merchantId: string, sessionId: string) {
      assert.equal(merchantId, "mrc_1"); assert.equal(sessionId, "chk_1"); this.checks++;
      throw new Error("checkout_coupon_binding_conflict");
    }
  }
  const repository = new BoundSessions(); repository.saveSession(checkoutSession());
  const useCase = new CompleteOrderUseCase(repository, repository, repository, undefined,
    undefined, undefined, undefined, transaction ? repository : undefined);
  await assert.rejects(useCase.execute(completeOrderRequest()), /checkout_coupon_binding_conflict/);
  assert.equal(repository.checks, 1);
  assert.equal(repository.getCompletedOrder("mrc_1", "chk_1", "ord_1"), undefined);
  assert.equal(repository.listOutbox("mrc_1").length, 0);
});

for (const privateValue of [undefined, null, { ...identity, state: "active" }]) test("Prisma public completion guard rejects private presence under canonical locks: " + JSON.stringify(privateValue), async () => {
  const calls: string[] = [];
  const cart = { _storefrontCouponBinding: privateValue };
  const tx = { async $queryRaw(parts: TemplateStringsArray) { const sql = parts.join("?");
    calls.push(sql.includes("FROM merchants") ? "merchant" : sql.includes("pg_advisory") ? "anchor" : "checkout"); return []; },
    checkoutSession: { async findUnique() { calls.push("read"); return { cart }; } } };
  const repo = new PrismaCheckoutRepository(tx as unknown as Prisma.TransactionClient, true);
  await assert.rejects(repo.assertPublicCompletionAllowed("mrc_1", "chk_1"), /checkout_coupon_binding_conflict/);
  assert.deepEqual(calls, ["merchant", "anchor", "checkout", "read"]);
});

test("legacy approval cannot publish through a bound canonical order transaction", async () => {
  const f = setup(); delete f.approval.couponAuthority;
  let checked = 0;
  f.repository.assertCouponOrderAuthority = async (_m, _s, a) => {
    checked++; assert.equal(a, undefined); throw new Error("checkout_coupon_binding_conflict");
  };
  await assert.rejects(f.useCase.executePaymentApproval(f.request, f.approval.id), /checkout_coupon_binding_conflict/);
  assert.equal(checked, 1);
  assert.equal(f.repository.getCompletedOrder("mrc_1", "chk_1", "ord_1"), undefined);
  assert.equal(f.repository.listOutbox("mrc_1").length, 0);
});

for (const [name, patch, supplied] of [
  ["missing frozen authority", {}, undefined],
  ["changed generation", { bindingId: "22222222-2222-4222-8222-222222222222" }, { ...identity, orderId: "ord_1" }],
  ["released", { state: "released" }, { ...identity, orderId: "ord_1" }],
  ["other completed order", { state: "redeemed", orderId: "other" }, { ...identity, orderId: "ord_1" }],
] as const) test("transactional authority guard rejects canonical " + name, async () => {
  const calls: string[] = [];
  const cart = { ...checkoutSession().cart, source: "storefront", cart_ref: "cart_1", currentDiscount: 10,
    _storefrontCouponBinding: { ...identity, state: "active", ...patch } };
  const tx = { async $queryRaw(parts: TemplateStringsArray) { const sql = parts.join("?");
    calls.push(sql.includes("FROM merchants") ? "merchant" : sql.includes("pg_advisory") ? "anchor" : "checkout"); return []; },
    checkoutSession: { async findUnique() { calls.push("read"); return { cart, globalUserId: "usr_1" }; } } };
  const repo = new PrismaCheckoutRepository(tx as unknown as Prisma.TransactionClient, true);
  await assert.rejects(repo.assertCouponOrderAuthority("mrc_1", "chk_1", supplied), /checkout_coupon_binding_conflict/);
  assert.deepEqual(calls, ["merchant", "anchor", "checkout", "read"]);
});
