import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { PaymentAmountBreakdown } from "../../../payment/domain/payment-amount.js";
import * as bindingPolicy from "../../../checkout/domain/services/checkout-coupon-binding.js";
import { PrismaBoundCouponRedemption } from "./prisma-bound-coupon-redemption.js";

const merchantId = "synthetic-bound-merchant", sessionId = "synthetic-bound-checkout", cartId = "synthetic-bound-cart", eventId = "synthetic-order-event";
const identity = () => ({ version: 1 as const, bindingId: "11111111-1111-4111-8111-111111111111", merchantId, checkoutSessionId: sessionId,
  cartId, buyerId: "synthetic-buyer", reservationBuyerId: null, redemptionId: "synthetic-redemption", couponId: "synthetic-coupon", discountCents: 137, basisHash: "ab".repeat(32) });
const authority = () => ({ ...identity(), orderId: "synthetic-provider-order" });
const receiptId = () => "evt_bound_coupon_" + createHash("sha256").update(JSON.stringify([merchantId, identity().bindingId, identity().redemptionId, authority().orderId])).digest("hex");
const receiptPayload = () => ({ session_id: sessionId, coupon_id: identity().couponId, order_id: authority().orderId, discount_applied: 1.37, buyer_global_user_id: "" });
function fixture() {
  const calls: string[] = [], queries: Array<{ text: string; values: unknown[] }> = [];
  const event = { eventId, merchantId, eventType: "order.completed", schemaVersion: 1, correlationId: "synthetic-correlation", payload: {
    session_id: sessionId, external_order_id: authority().orderId, payment_intent_id: "synthetic-payment", coupon_authority: authority() } };
  const checkout = { id: "synthetic-checkout-row", merchantId, sessionId, globalUserId: identity().buyerId, version: 7,
    cart: { source: "storefront", cart_ref: cartId, currentDiscount: 1.37, items: [], total: 10, currency: "BRL", _storefrontCouponBinding: { ...identity(), state: "active" } } };
  const redemption = { id: identity().redemptionId, merchantId, sessionId: cartId, couponId: identity().couponId, buyerGlobalUserId: null,
    discountApplied: new Prisma.Decimal("1.37"), status: "applied", orderId: null as string | null };
  const payment = { id: "synthetic-payment", merchantId, sessionId, amountCents: 1000, approvedAmountCents: 1000, currency: "BRL", method: "pix", providerPaymentId: authority().orderId,
    amountBreakdown: null as PaymentAmountBreakdown | null,
    creation: { couponAuthority: identity(), input: { intentId: "synthetic-payment", merchantId, sessionId, amountCents: 1000, currency: "BRL", method: "pix" } } };
  const order = { merchantId, sessionId, externalOrderId: authority().orderId, currency: "BRL", orderTotal: new Prisma.Decimal(10) };
  let receipt: unknown = null, eventRead = 0;
  const controls = { missingOrder: false, missingPayment: false, missingCheckout: false, missingCoupon: false, casCount: 1, checkoutCasCount: 1,
    fail: "", afterEventRead: undefined as undefined | (() => void) };
  const failure = new Error("synthetic-storage-unknown");
  const tx = {
    async $executeRaw(parts: TemplateStringsArray, ...values: unknown[]) { calls.push("cart-lock"); queries.push({ text: parts.join("?"), values }); return 1; },
    async $queryRaw(parts: TemplateStringsArray, ...values: unknown[]) {
      const text = parts.join("?"); queries.push({ text, values });
      const step = text.includes("FROM merchants") ? "merchant-lock" : text.includes("checkout-session") || text.includes("pg_advisory_xact_lock") ? "checkout-anchor"
        : text.includes("FROM checkout_sessions") ? "checkout-lock" : text.includes("FROM coupons") ? "coupon-lock" : text.includes("FROM outbox_messages") ? "event-lock" : "unexpected";
      calls.push(step); assert.notEqual(step, "unexpected");
      if (step === "coupon-lock" && controls.missingCoupon) return [];
      return [{ id: step === "merchant-lock" ? merchantId : step === "coupon-lock" ? identity().couponId : "synthetic-row" }];
    },
    outboxMessage: {
      async findFirst(args: { where: { eventId: string; merchantId: string } }) { calls.push(args.where.eventId === eventId ? "event-read" : "receipt-read");
        assert.equal(args.where.merchantId, merchantId);
        if (args.where.eventId !== eventId) return receipt;
        eventRead++; if (eventRead === 2) controls.afterEventRead?.(); return structuredClone(event); },
      async upsert(args: { create: unknown }) { calls.push("outbox-write"); if (controls.fail === "outbox") throw failure; receipt = args.create; return receipt; },
    },
    checkoutSession: {
      async findUnique() { calls.push("checkout-read"); return controls.missingCheckout ? null : checkout; },
      async updateMany(args: { data: { cart: unknown } }) { calls.push("binding-cas"); if (controls.fail === "binding") throw failure;
        return { count: controls.checkoutCasCount }; },
    },
    completedOrder: { async findFirst() { calls.push("order-read"); return controls.missingOrder ? null : order; } },
    paymentIntent: { async findFirst() { calls.push("payment-read"); return controls.missingPayment ? null : payment; } },
    couponRedemption: {
      async findFirst() { calls.push("redemption-read"); return redemption; },
      async updateMany() { calls.push("redemption-cas"); return { count: controls.casCount }; },
    },
    coupon: { async updateMany() { calls.push("coupon-usage"); if (controls.fail === "usage") throw failure; return { count: 1 }; } },
  };
  const prisma = { ...tx, async $transaction<T>(work: (value: unknown) => Promise<T>, config: unknown) {
    calls.push("begin"); assert.deepEqual(config, { isolationLevel: "ReadCommitted", maxWait: 10_000, timeout: 15_000 });
    try { const result = await work(tx); if (controls.fail === "commit") throw failure; calls.push("commit"); return result; }
    catch (error) { calls.push("rollback"); throw error; }
  } } as unknown as PrismaClient;
  return { service: new PrismaBoundCouponRedemption(prisma), calls, queries, checkout, redemption, event, payment, order, controls, failure,
    receipt: () => receipt, setReceipt: (value: unknown) => { receipt = value; } };
}
const conflict = (work: () => Promise<unknown>) => assert.rejects(work, /checkout_coupon_binding_conflict/);

test("strict order authority parser returns detached V1 snapshot", () => {
  const fn = Reflect.get(bindingPolicy, "parseCheckoutCouponOrderAuthority"); assert.equal(typeof fn, "function");
  const value = authority(), output = fn(value); value.cartId = "mutated"; assert.equal(output.cartId, cartId);
  for (const invalid of [null, identity(), { ...authority(), extra: true }, { ...authority(), state: "active" }, { ...authority(), discountCents: "137" }])
    assert.throws(() => fn(invalid), /checkout_coupon_binding_conflict/);
});
test("persisted reference commands one exact redemption, one usage, binding CAS and private-free receipt", async () => {
  const f = fixture(); await f.service.redeem({ merchantId, eventId });
  for (const step of ["redemption-cas", "coupon-usage", "binding-cas", "outbox-write", "commit"]) assert.equal(f.calls.filter(call => call === step).length, 1);
  assert.ok(f.calls.indexOf("merchant-lock") < f.calls.indexOf("checkout-anchor"));
  assert.ok(f.calls.indexOf("checkout-lock") < f.calls.indexOf("cart-lock"));
  assert.ok(f.calls.indexOf("cart-lock") < f.calls.indexOf("coupon-lock"));
  const receipt = f.receipt() as { eventId: string; payload: unknown }; assert.equal(receipt.eventId, receiptId());
  assert.deepEqual(receipt.payload, receiptPayload()); assert.equal(JSON.stringify(receipt).includes("basisHash"), false);
});
for (const field of ["bindingId", "buyerId", "basisHash", "cartId", "checkoutSessionId", "redemptionId", "couponId", "merchantId", "discountCents"] as const) {
  test(`old persisted order cannot select current ${field}`, async () => {
    const f = fixture(); Reflect.set(f.checkout.cart._storefrontCouponBinding, field, field === "discountCents" ? 138 : field === "bindingId" ? "22222222-2222-4222-8222-222222222222" : "different");
    await conflict(() => f.service.redeem({ merchantId, eventId })); assert.equal(f.calls.includes("redemption-cas"), false);
  });
}
for (const missing of ["missingOrder", "missingPayment", "missingCheckout", "missingCoupon"] as const) test(`${missing} refuses without writes`, async () => {
  const f = fixture(); f.controls[missing] = true; await conflict(() => f.service.redeem({ merchantId, eventId })); assert.equal(f.calls.includes("redemption-cas"), false);
});
for (const invalid of ["1.371", "0", "-1", "1.38"]) test(`reservation amount ${invalid} cannot be rounded/coerced into authority`, async () => {
  const f = fixture(); f.redemption.discountApplied = new Prisma.Decimal(invalid);
  await conflict(() => f.service.redeem({ merchantId, eventId })); assert.equal(f.calls.includes("redemption-cas"), false);
});
test("journal authority cannot be reconstructed from current checkout", async () => {
  const f = fixture(); Reflect.deleteProperty(f.payment.creation, "couponAuthority");
  await conflict(() => f.service.redeem({ merchantId, eventId })); assert.equal(f.calls.includes("redemption-cas"), false);
});
test("forged frozen authority cannot be supplied as a caller override", async () => {
  const f = fixture(); await conflict(() => f.service.redeem({ merchantId, eventId, orderAuthority: authority() } as never)); assert.deepEqual(f.calls, []);
});
test("source authority changed while waiting conflicts instead of changing lock scope", async () => {
  const f = fixture(); f.controls.afterEventRead = () => { f.event.payload.coupon_authority.bindingId = "22222222-2222-4222-8222-222222222222"; };
  await conflict(() => f.service.redeem({ merchantId, eventId })); assert.equal(f.calls.includes("redemption-cas"), false);
});
test("coherent same-order replay requires exact receipt and has no financial writes", async () => {
  const f = fixture(); f.checkout.cart._storefrontCouponBinding.state = "redeemed"; Reflect.set(f.checkout.cart._storefrontCouponBinding, "orderId", authority().orderId);
  f.redemption.status = "redeemed"; f.redemption.orderId = authority().orderId;
  f.setReceipt({ eventId: receiptId(), eventType: "coupon.redeemed", merchantId, payload: receiptPayload() });
  await f.service.redeem({ merchantId, eventId }); assert.equal(f.calls.includes("redemption-cas"), false); assert.equal(f.calls.includes("outbox-write"), false);
});
test("partially redeemed or missing receipt cannot be acknowledged as an atomic replay", async () => {
  for (const canonicalState of ["active", "redeemed"]) {
    const f = fixture(); f.checkout.cart._storefrontCouponBinding.state = canonicalState;
    if (canonicalState === "redeemed") Reflect.set(f.checkout.cart._storefrontCouponBinding, "orderId", authority().orderId);
    f.redemption.status = "redeemed"; f.redemption.orderId = authority().orderId;
    await conflict(() => f.service.redeem({ merchantId, eventId })); assert.equal(f.calls.includes("redemption-cas"), false);
  }
});
for (const step of ["usage", "binding", "outbox", "commit"]) test(`${step} failure is not retried or converted into success`, async () => {
  const f = fixture(); f.controls.fail = step;
  await assert.rejects(f.service.redeem({ merchantId, eventId }), error => error === f.failure);
  assert.equal(f.calls.filter(call => call === "begin").length, 1); assert.equal(f.calls.at(-1), "rollback");
});
for (const kind of ["redemption", "binding"] as const) test(`${kind} CAS count0 aborts transaction`, async () => {
  const f = fixture(); if (kind === "redemption") f.controls.casCount = 0; else f.controls.checkoutCasCount = 0;
  await conflict(() => f.service.redeem({ merchantId, eventId })); assert.equal(f.calls.at(-1), "rollback");
});
for (const approved of [null, 999, 0]) test(`payment without the exact approved monetary fact (${approved}) cannot consume coupon`, async () => {
  const f = fixture(); Reflect.set(f.payment, "approvedAmountCents", approved);
  await conflict(() => f.service.redeem({ merchantId, eventId })); assert.equal(f.calls.includes("redemption-cas"), false);
});
test("unknown payment method cannot pass through matching opaque journal strings", async () => {
  const f = fixture(); f.payment.method = "invalid"; f.payment.creation.input.method = "invalid";
  await conflict(() => f.service.redeem({ merchantId, eventId })); assert.equal(f.calls.includes("redemption-cas"), false);
});
test("foreign receipt lookup is always tenant-scoped", async () => {
  const f = fixture(); await f.service.redeem({ merchantId, eventId });
  // All receipt lookups, including the post-upsert consistency check, are
  // asserted in the narrow fake below; they cannot probe another tenant.
  assert.equal(f.calls.filter(call => call === "receipt-read").length, 2);
});
test("unknown source event envelope version must not be interpreted as V1", async () => {
  const f = fixture(); f.event.schemaVersion = 2;
  await conflict(() => f.service.redeem({ merchantId, eventId })); assert.equal(f.calls.includes("redemption-cas"), false);
});

function withBuyerFee(f: ReturnType<typeof fixture>) {
  f.payment.amountCents = f.payment.approvedAmountCents = f.payment.creation.input.amountCents = 1099;
  f.payment.amountBreakdown = { version: 1, currency: "BRL", itemsSubtotalCents: 1137, discountCents: 137,
    shippingCents: 0, platformFeeCents: 99, totalCents: 1099 };
}

test("buyer fee belongs to approved payment, not merchant order or coupon consumption", async () => {
  const f = fixture(); withBuyerFee(f); const before = structuredClone(f.payment);
  await f.service.redeem({ merchantId, eventId });
  assert.deepEqual(f.payment, before); assert.equal(f.order.orderTotal.toString(), "10");
  assert.deepEqual((f.receipt() as { payload: unknown }).payload, receiptPayload());
});

test("coherent fee-backed replay makes no writes or monetary adjustments", async () => {
  const f = fixture(); withBuyerFee(f);
  f.checkout.cart._storefrontCouponBinding.state = "redeemed";
  Reflect.set(f.checkout.cart._storefrontCouponBinding, "orderId", authority().orderId);
  f.redemption.status = "redeemed"; f.redemption.orderId = authority().orderId;
  f.setReceipt({ eventId: receiptId(), eventType: "coupon.redeemed", merchantId, payload: receiptPayload() });
  await f.service.redeem({ merchantId, eventId });
  assert.equal(f.calls.includes("redemption-cas"), false); assert.equal(f.calls.includes("outbox-write"), false);
});

test("zero merchant total with a positive fee-backed payment preserves a fully discounted order", async () => {
  const f = fixture(); withBuyerFee(f); f.order.orderTotal = new Prisma.Decimal(0);
  f.payment.amountCents = f.payment.approvedAmountCents = f.payment.creation.input.amountCents = 99;
  f.payment.amountBreakdown!.itemsSubtotalCents = 137; f.payment.amountBreakdown!.totalCents = 99;
  await f.service.redeem({ merchantId, eventId }); assert.equal(f.calls.includes("redemption-cas"), true);
});

for (const [label, patch] of [
  ["unknown version", { version: 2 }], ["wrong currency", { currency: "USD" }],
  ["fractional cents", { platformFeeCents: 0.5, totalCents: 1000.5 }],
  ["string cents", { discountCents: "137" }], ["negative fee", { platformFeeCents: -1, totalCents: 999 }],
  ["unsafe cents", { itemsSubtotalCents: Number.MAX_SAFE_INTEGER + 1 }],
  ["NaN cents", { totalCents: NaN }], ["invalid arithmetic", { totalCents: 999 }],
  ["other discount with same total", { itemsSubtotalCents: 1138, discountCents: 138 }],
] as const) test(`canonical breakdown ${label} fails before effects even when approved total equals order total`, async () => {
  const f = fixture(); f.payment.amountBreakdown = { version: 1, currency: "BRL", itemsSubtotalCents: 1137, discountCents: 137,
    shippingCents: 0, platformFeeCents: 0, totalCents: 1000 };
  Object.assign(f.payment.amountBreakdown, patch);
  await conflict(() => f.service.redeem({ merchantId, eventId })); assert.equal(f.calls.includes("redemption-cas"), false);
});

for (const breakdown of [{}, [], "private-breakdown-canary", 0, false]) test(`malformed persisted breakdown ${JSON.stringify(breakdown)} is not treated as legacy absence`, async () => {
  const f = fixture(); Reflect.set(f.payment, "amountBreakdown", breakdown);
  await conflict(() => f.service.redeem({ merchantId, eventId })); assert.equal(f.calls.includes("redemption-cas"), false);
});

test("fee is never inferred from payment/order difference when canonical breakdown is absent", async () => {
  const f = fixture(); withBuyerFee(f); f.payment.amountBreakdown = null;
  await conflict(() => f.service.redeem({ merchantId, eventId })); assert.equal(f.calls.includes("redemption-cas"), false);
});

test("negative merchant order cannot be rounded or offset by a platform fee", async () => {
  const f = fixture(); withBuyerFee(f); f.order.orderTotal = new Prisma.Decimal("-0.01");
  await conflict(() => f.service.redeem({ merchantId, eventId })); assert.equal(f.calls.includes("redemption-cas"), false);
});
