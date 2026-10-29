import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { captureStorefrontCouponForPayment, readStorefrontCouponForCheckout, StorefrontCouponEligibilityReviewRequired } from "./prisma-storefront-coupon-admission.js";
import { checkoutSession, merchantRules } from "../../../checkout/__tests__/checkout-test-fixtures.js";
import { paymentCartFingerprint } from "../../../checkout/domain/services/payment-cart-fingerprint.js";
import type { PaymentIntentSnapshot } from "../../../payment/domain/payment-intent.entity.js";

function fixture() {
  const scope = { merchantId: "mrc_1", checkoutSessionId: "chk_1", cartId: "cart_1", buyerId: "usr_1" };
  const session = checkoutSession({ persistenceVersion: 3, cart: { currency: "BRL", source: "storefront", cart_ref: "cart_1",
    total: 100, currentDiscount: 10, items: [{ sku: "SKU", variantId: "v_1", product_id: "p_1",
      variant: JSON.stringify(["v_1", []]), name: "Synthetic", quantity: 1, price: 100 }] },
    customer: { email: "buyer@example.invalid", email_verified: true }, shipping: { customerPrice: 5, realCost: 5, region: "SP" } });
  const row = { ...session, id: "checkout-row", version: 3, createdAt: new Date(0), updatedAt: new Date(0) };
  const cart = { merchantId: "mrc_1", sessionId: "cart_1", couponCode: "SAVE10", discount: 1000, freeShipping: false,
    total: 10000, expiresAt: new Date(Date.now() + 3600000),
    items: [{ sku: "SKU", variantId: "v_1", productId: "p_1", name: "Synthetic", quantity: 1, unitPriceCents: 10000 }] };
  const coupon = { id: "coupon_1", merchantId: "mrc_1", code: "SAVE10", discountType: "percent", discountValue: new Prisma.Decimal(10),
    minCartTotal: null, maxUsages: 100, maxPerBuyer: null, usagesCount: 0, status: "active", startsAt: new Date(0), endsAt: null,
    allowedSkus: [], blockedSkus: [], allowedRegions: [], blockedRegions: [], createdAt: new Date(0), updatedAt: new Date(0), strategyIncentiveExecutionId: null };
  const reservation = { id: "reservation_1", merchantId: "mrc_1", sessionId: "cart_1", couponId: "coupon_1", buyerGlobalUserId: null,
    discountApplied: new Prisma.Decimal(10), status: "applied", orderId: null };
  const snapshot: PaymentIntentSnapshot = { id: "payment_1", merchantId: "mrc_1", sessionId: "chk_1", idempotencyKey: "key_1", version: 0,
    method: "pix", status: "pending", amountCents: 9599, currency: "BRL", statusHistory: [],
    amountBreakdown: { version: 1, currency: "BRL", itemsSubtotalCents: 10000, discountCents: 1000, shippingCents: 500,
      platformFeeCents: 99, totalCents: 9599, cartFingerprint: paymentCartFingerprint(session) },
    creation: { state: "ready", input: { intentId: "payment_1", merchantId: "mrc_1", sessionId: "chk_1", method: "pix", amountCents: 9599, currency: "BRL" } } };
  const rules = { merchantId: "mrc_1", ...merchantRules({ maxDiscountPercent: 15 }) };
  const owners: Array<Record<string, unknown>> = [];
  const writes: unknown[] = [];
  const tx = { async $queryRaw(parts: TemplateStringsArray) { const sql = parts.join("?");
    return sql.includes("current_setting") ? [{ isolation: "read committed", candidates: owners }] : [{ id: coupon.id }]; },
    checkoutSession: { async findUnique() { return row; }, async updateMany(args: unknown) { writes.push(args); return { count: 1 }; } },
    storefrontCart: { async findUnique() { return cart; } }, merchantRule: { async findUnique() { return rules; }, async upsert() { return rules; } },
    coupon: { async findFirst() { return coupon; } }, couponRedemption: { async findMany() { return [reservation]; }, async count() { return 1; } },
    completedOrder: { async findFirst() { return null; } }, paymentIntent: { async findFirst() { return null; } } };
  return { tx: tx as unknown as Prisma.TransactionClient, scope, session, row, cart, coupon, reservation, snapshot, rules, owners, writes };
}

test("trusted first admission issues one private binding and returns detached journal identity, not a provider field", async () => {
  const f = fixture(); const before = structuredClone(f.snapshot);
  const a = await captureStorefrontCouponForPayment(f.tx, f.snapshot, f.scope);
  assert.ok(a); assert.match(a.bindingId, /^[a-f0-9-]{36}$/); assert.equal(a.cartId, "cart_1"); assert.equal(a.checkoutSessionId, "chk_1");
  assert.equal(a.redemptionId, "reservation_1"); assert.equal(a.discountCents, 1000); assert.equal(a.reservationBuyerId, null);
  assert.equal(a.basisHash, paymentCartFingerprint(f.session));
  assert.equal(f.writes.length, 1); assert.deepEqual(f.snapshot, before);
  assert.equal(Object.hasOwn(a, "state"), false); assert.equal(Object.hasOwn(a, "orderId"), false);
});

for (const field of ["merchantId", "checkoutSessionId", "cartId", "buyerId"] as const) test("private admission scope rejects mismatched " + field + " before writes", async () => {
  const f = fixture(); await assert.rejects(captureStorefrontCouponForPayment(f.tx, f.snapshot, { ...f.scope, [field]: "foreign" }), /checkout_coupon_binding_conflict/);
  assert.equal(f.writes.length, 0);
});

for (const condition of ["missing scope", "unverified buyer", "expired source", "stale quantity", "stale base", "other reservation buyer", "over cap", "canceled reservation", "missing policy", "shipping-only"] as const) {
  test("admission fails closed for " + condition + " without writing binding or journal", async () => {
    const f = fixture(); let scope: typeof f.scope | undefined = f.scope;
    if (condition === "missing scope") scope = undefined;
    if (condition === "unverified buyer") f.row.customer!.email_verified = false;
    if (condition === "expired source") f.cart.expiresAt = new Date(0);
    if (condition === "stale quantity") f.cart.items[0].quantity++;
    if (condition === "stale base") f.cart.items[0].unitPriceCents++;
    if (condition === "other reservation buyer") Reflect.set(f.reservation, "buyerGlobalUserId", "other");
    if (condition === "over cap") f.rules.maxDiscountPercent = 5;
    if (condition === "canceled reservation") f.reservation.status = "cancelled";
    if (condition === "missing policy") Reflect.set(f.tx.merchantRule, "findUnique", async () => null);
    if (condition === "shipping-only") { f.cart.discount = 0; f.cart.freeShipping = true; }
    await assert.rejects(captureStorefrontCouponForPayment(f.tx, f.snapshot, scope), /checkout_coupon_binding_conflict/);
    assert.equal(f.writes.length, 0);
  });
}

test("a different canonical checkout owner cannot finance the same reservation", async () => {
  const f = fixture(); f.owners.push({ merchantId: "mrc_1", sessionId: "chk_other", buyerId: "usr_1", cartRef: "cart_1", binding: {
    version: 1, bindingId: "11111111-1111-4111-8111-111111111111", merchantId: "mrc_1", cartId: "cart_1", checkoutSessionId: "chk_other",
    buyerId: "usr_1", reservationBuyerId: null, redemptionId: "reservation_1", couponId: "coupon_1", discountCents: 1000,
    basisHash: paymentCartFingerprint(f.session), state: "active" } });
  await assert.rejects(captureStorefrontCouponForPayment(f.tx, f.snapshot, f.scope), /checkout_coupon_binding_conflict/);
  assert.equal(f.writes.length, 0);
});

test("storefront discount without a coupon does not invent coupon authority", async () => {
  const f = fixture(); Reflect.set(f.cart, "couponCode", null);
  assert.equal(await captureStorefrontCouponForPayment(f.tx, f.snapshot), undefined);
  assert.equal(f.writes.length, 0);
});

test("normal form can revalidate a coupon before buyer verification without issuing authority", async () => {
  const f = fixture(); f.session.customer!.email_verified = false;
  const candidate = await readStorefrontCouponForCheckout(f.tx, f.session);
  assert.equal(candidate?.discountCents, 1000); assert.equal(candidate?.couponCode, "SAVE10");
  assert.equal(f.writes.length, 0); assert.equal(Object.hasOwn(candidate!, "bindingId"), false);
});

test("commercial review is typed only after exact reservation identity and D passed", async () => {
  const f = fixture(); f.rules.maxDiscountPercent = 5;
  await assert.rejects(readStorefrontCouponForCheckout(f.tx, f.session), error => {
    assert.ok(error instanceof StorefrontCouponEligibilityReviewRequired);
    assert.equal(error.reason, "discount_ceiling_changed"); assert.equal(error.candidate.redemptionId, "reservation_1");
    assert.equal(error.candidate.discountCents, 1000); return true;
  });
  f.reservation.status = "cancelled";
  await assert.rejects(readStorefrontCouponForCheckout(f.tx, f.session), error => {
    assert.ok(error instanceof Error); assert.equal(error instanceof StorefrontCouponEligibilityReviewRequired, false);
    assert.equal(error.message, "checkout_coupon_binding_conflict"); return true;
  });
  assert.equal(f.writes.length, 0);
});

test("a zero-price quote needs an actual shipping cost; missing cost is not treated as free pickup", async () => {
  const f = fixture(); f.session.shipping!.customerPrice = 0;
  Reflect.deleteProperty(f.session.shipping!, "realCost");
  await assert.rejects(readStorefrontCouponForCheckout(f.tx, f.session), /^Error: checkout_coupon_binding_conflict$/);
  f.session.shipping!.realCost = 0;
  assert.equal((await readStorefrontCouponForCheckout(f.tx, f.session))?.discountCents, 1000);
  f.session.shipping!.realCost = 5;
  await assert.rejects(readStorefrontCouponForCheckout(f.tx, f.session), error => {
    assert.ok(error instanceof StorefrontCouponEligibilityReviewRequired);
    assert.equal(error.reason, "shipping_stacking_changed"); return true;
  });
  assert.equal(f.writes.length, 0);
});
