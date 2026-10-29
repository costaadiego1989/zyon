import test from "node:test";
import assert from "node:assert/strict";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { CheckoutSession } from "@zyon/shared-types";
import { checkoutSession, merchantRules } from "../../__tests__/checkout-test-fixtures.js";
import { PrismaCheckoutRepository } from "./prisma-checkout.repository.js";
import { toCheckoutSession, toCheckoutShippingJson } from "./checkout-session.mapper.js";
import { paymentCartFingerprint } from "../../domain/services/payment-cart-fingerprint.js";
import { CheckoutBenefitsService } from "../../application/services/checkout-benefits.service.js";
import { storefrontCartHasCheckoutBinding } from "../../../storefront/infrastructure/repositories/storefront-checkout-binding-fence.js";
import { captureStorefrontCouponForPayment } from "../../../coupons/infrastructure/repositories/prisma-storefront-coupon-admission.js";

const KEY = "_storefrontCouponBinding";
function fixture(bound = false) {
  const session = checkoutSession({ persistenceVersion: 3, customer: { email: "buyer@example.invalid", email_verified: true,
    address: { state: "SP", zip: "01001000", street: "Rua", number: "1", city: "São Paulo" } },
    cart: { currency: "BRL", source: "storefront", cart_ref: "cart_1", total: 100, currentDiscount: 10,
      commercialNudge: { kind: "coupon", title: "Cupom aplicado", message: "Válido", couponCode: "SAVE10" },
      items: [{ sku: "SKU", variantId: "v_1", product_id: "p_1", variant: JSON.stringify(["v_1", []]), name: "Produto", price: 100, quantity: 1 }] },
    shipping: { customerPrice: 5, realCost: 5, region: "SP", carrier: "Carrier", method: "PAC" },
    shippingOptions: [{ customerPrice: 5, realCost: 5, region: "SP", carrier: "Carrier", method: "PAC" },
      { customerPrice: 7, realCost: 7, region: "SP", carrier: "Carrier", method: "EXPRESS" }] });
  const binding = { version: 1, bindingId: "11111111-1111-4111-8111-111111111111", merchantId: "mrc_1", checkoutSessionId: "chk_1",
    cartId: "cart_1", buyerId: "usr_1", reservationBuyerId: null, couponId: "coupon_1", redemptionId: "reservation_1",
    discountCents: 1000, basisHash: paymentCartFingerprint(session), state: "active" };
  const { state: _state, ...authority } = binding;
  let row = { ...session, id: "checkout-row", version: 3, createdAt: new Date(session.createdAt), updatedAt: new Date(session.updatedAt),
    customer: session.customer ?? null, shipping: session.shipping ?? null,
    cart: { ...session.cart, ...(bound ? { [KEY]: binding } : {}) } as unknown as Record<string, unknown> };
  let source = { id: "cart-row", merchantId: "mrc_1", sessionId: "cart_1", couponCode: "SAVE10", discount: 1000, freeShipping: false,
    items: [{ sku: "SKU", variantId: "v_1", productId: "p_1", name: "Produto", quantity: 1, unitPriceCents: 10000 }], total: 10000,
    updatedAt: new Date(0), expiresAt: new Date(Date.now() + 3600000) };
  const coupon = { id: "coupon_1", merchantId: "mrc_1", code: "SAVE10", discountType: "percent", discountValue: new Prisma.Decimal(10),
    minCartTotal: null, maxUsages: 100, maxPerBuyer: null, usagesCount: 0, status: "active", startsAt: new Date(0), endsAt: null,
    allowedSkus: [] as string[], blockedSkus: [] as string[], allowedRegions: [] as string[], blockedRegions: [] as string[], createdAt: new Date(0), updatedAt: new Date(0), strategyIncentiveExecutionId: null };
  const reservation = { id: "reservation_1", merchantId: "mrc_1", sessionId: "cart_1", couponId: "coupon_1", buyerGlobalUserId: null,
    discountApplied: new Prisma.Decimal(10), status: "applied", orderId: null };
  const payments: Record<string, unknown>[] = bound ? [{ id: "payment_1", merchantId: "mrc_1", sessionId: "chk_1", method: "pix", currency: "BRL", amountCents: 9599,
    status: "cancelled", providerPaymentId: "provider_1", approvedAmountCents: null,
    creation: { state: "complete", couponAuthority: authority,
      input: { intentId: "payment_1", merchantId: "mrc_1", sessionId: "chk_1", method: "pix", currency: "BRL", amountCents: 9599 },
      cancellation: { operationId: "cancel_payment_1", idempotencyKey: "key", buyerId: "usr_1", providerPaymentId: "provider_1", state: "cancelled", startedAt: "2026-10-19T12:00:00.000Z" } } }] : [];
  const outbox: Record<string, unknown>[] = [], events: { eventName: string }[] = [], writes: string[] = [];
  const rules = { merchantId: "mrc_1", ...merchantRules({ maxDiscountPercent: 15 }) };
  let sourceCasFails = false, paid = false;
  const apply = (data: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(data)) if (value !== undefined) Reflect.set(row, key, value === Prisma.DbNull || value === Prisma.JsonNull ? null : structuredClone(value));
    row.version++; row.persistenceVersion = row.version;
    return row;
  };
  const tx = { async $executeRaw() { return 1; },
    async $queryRaw(parts: TemplateStringsArray) {
      const sql = parts.join("?");
      if (sql.includes("current_setting")) return [{ isolation: "read committed", candidates: row.cart[KEY] ? [{ merchantId: row.merchantId,
        sessionId: row.sessionId, buyerId: row.globalUserId, cartRef: "cart_1", binding: row.cart[KEY] }] : [] }];
      return [{ id: coupon.id }];
    },
    checkoutSession: { async findUnique() { return row; }, async updateMany(args: { where: { version: number }; data: Record<string, unknown> }) {
      if (args.where.version !== row.version) return { count: 0 }; writes.push("checkout"); apply(args.data); return { count: 1 };
    }, async update(args: { data: Record<string, unknown> }) { writes.push("checkout-event"); return apply(args.data); } },
    storefrontCart: { async findUnique() { return source; }, async updateMany(args: { data: Record<string, unknown> }) {
      writes.push("source"); if (sourceCasFails) return { count: 0 }; source = { ...source, ...args.data }; return { count: 1 };
    } },
    merchantRule: { async findUnique() { return rules; }, async upsert() { return rules; } },
    checkoutSetting: { async findUnique() { return { advancedRules: [] }; } },
    coupon: { async findFirst() { return coupon; } },
    couponRedemption: { async findMany() { return reservation.status === "applied" ? [reservation] : []; }, async findFirst() { return reservation; }, async count() { return reservation.status === "applied" ? 1 : 0; },
      async updateMany(args: { where: { id: string; sessionId: string }; data: { status: string } }) {
        assert.equal(args.where.id, reservation.id); assert.equal(args.where.sessionId, "cart_1"); writes.push("reservation"); reservation.status = args.data.status; return { count: 1 };
      } },
    paymentIntent: { async findFirst() { return payments.find(value => !["failed", "cancelled"].includes(String(value.status))) ?? null; }, async findMany() { return payments; } },
    completedOrder: { async findFirst() { return paid ? { id: "paid-order" } : null; } },
    checkoutChatRequest: { async findFirst() { return null; } },
    checkoutEvent: { async findFirst() { return null; }, async findMany() { return events; }, async create(args: { data: { eventName: string } }) { events.push(args.data); } },
    outboxMessage: { async findFirst(args: { where: { eventId: string } }) { return outbox.find(value => value.eventId === args.where.eventId) ?? null; },
      async upsert(args: { create: Record<string, unknown> }) { if (!outbox.some(value => value.eventId === args.create.eventId)) outbox.push(args.create); return args.create; } },
  };
  const prisma = { ...tx, async $transaction<T>(work: (value: typeof tx) => Promise<T>) {
    const before = { row: structuredClone(row), source: structuredClone(source), status: reservation.status, outbox: structuredClone(outbox), events: structuredClone(events) };
    try { return await work(tx); } catch (error) {
      row = before.row; source = before.source; reservation.status = before.status; outbox.splice(0, outbox.length, ...before.outbox); events.splice(0, events.length, ...before.events); throw error;
    }
  } };
  const repo = new PrismaCheckoutRepository(prisma as unknown as PrismaClient);
  return { repo, tx: tx as unknown as Prisma.TransactionClient, row: () => row, source: () => source, coupon, reservation, payments, outbox, events, writes,
    session: () => toCheckoutSession(row), sourceCasFailure: () => { sourceCasFails = true; }, paid: () => { paid = true; }, rules };
}

test("shipping JSON serialization preserves exact scalar fields without inventing optional cost", () => {
  const quote = { customerPrice: 5, carrier: "Carrier", method: "PAC" };
  const serialized = toCheckoutShippingJson(quote);
  assert.deepEqual(serialized, quote); assert.notEqual(serialized, quote);
  assert.equal(Object.hasOwn(serialized, "realCost"), false);
});
test("shipping JSON serialization rejects non-finite monetary values rather than converting them to null", () => {
  assert.throws(() => toCheckoutShippingJson({ customerPrice: NaN }), /invalid_shipping_quote_json/);
  assert.throws(() => toCheckoutShippingJson({ customerPrice: 5, realCost: Infinity }), /invalid_shipping_quote_json/);
});

for (const change of ["customer", "address", "shipping"] as const) test(`normal ${change} preserves exact storefront coupon D without anonymous checkout grant`, async () => {
  const f = fixture(), expected = f.session(), next = structuredClone(expected);
  if (change === "customer") next.customer = { ...next.customer, cpf: "12345678901", fullName: "Pessoa sintética" };
  if (change === "address") next.customer!.address = { ...next.customer!.address, state: "RJ", city: "Rio" };
  if (change === "shipping") next.shipping = next.shippingOptions![1];
  const result = await f.repo.commitCommercialMutation({ expected, next });
  assert.equal(result.cart.currentDiscount, 10); assert.equal(result.cart.commercialNudge?.kind, "coupon");
  assert.equal(f.reservation.status, "applied"); assert.equal(f.source().discount, 1000);
  assert.equal(f.writes.includes("reservation"), false);
  if (change === "address") assert.equal(result.shipping, undefined);
  if (change === "shipping") assert.equal(result.shipping?.customerPrice, 7);
});
test("blocked new region saves the form with explicit pending-discount notice but payment preparation returns canonical409", async () => {
  const f = fixture(); f.coupon.blockedRegions = ["RJ"];
  const expected = f.session(), next = structuredClone(expected); next.customer!.address!.state = "RJ";
  const saved = await f.repo.commitCommercialMutation({ expected, next });
  assert.equal(saved.customer?.address?.state, "RJ"); assert.equal(saved.cart.currentDiscount, 10);
  assert.match(saved.cart.commercialNotices?.[0].message ?? "", /em revisão/);
  await assert.rejects(f.repo.prepareStorefrontCouponBenefits("mrc_1", "chk_1", "pix"), (error: { getResponse(): { code: string } }) => error.getResponse().code === "checkout_review_required");
});
test("coupon payment preparation preserves D and does not call coupon or progressive grant path", async () => {
  const f = fixture();
  const service = new CheckoutBenefitsService(f.repo, {} as never, {} as never,
    { hasCommittedPaymentForSession: async () => false } as never,
    { executeForCheckout: async () => assert.fail("must not create checkout-scoped coupon redemption") } as never);
  const result = await service.prepare("mrc_1", "chk_1", "pix");
  assert.equal(result.cart.currentDiscount, 10); assert.equal(f.reservation.status, "applied");
  assert.equal(f.events.filter(value => value.eventName === "payment_method_selected").length, 1);
});
test("unverified source coupon never becomes an anonymous checkout reservation during benefits", async () => {
  const f = fixture(); f.row().customer!.email_verified = false;
  await assert.rejects(f.repo.prepareStorefrontCouponBenefits("mrc_1", "chk_1", "pix"));
  assert.equal(f.writes.length, 0); assert.equal(f.reservation.buyerGlobalUserId, null);
});
for (const condition of ["forged shipping", "changed merchandise", "changed buyer"] as const) test(`normal coupon form rejects ${condition} rather than changing authority`, async () => {
  const f = fixture(), expected = f.session(), next = structuredClone(expected);
  if (condition === "forged shipping") next.shipping = { ...next.shipping!, customerPrice: 0 };
  if (condition === "changed merchandise") next.cart.items[0].price--;
  if (condition === "changed buyer") next.globalUserId = "foreign";
  await assert.rejects(f.repo.commitCommercialMutation({ expected, next }));
  assert.equal(f.source().discount, 1000); assert.equal(f.reservation.status, "applied"); assert.equal(f.writes.length, 0);
});
test("definitively cancelled bound payment reopens with exact release, tombstone and single durable receipt", async () => {
  const f = fixture(true);
  const result = await f.repo.reopenForBuyerEdit("mrc_1", "chk_1", "address");
  assert.equal(result.cart.currentDiscount, 0); assert.equal(result.shipping, undefined);
  assert.equal(Object.hasOwn(result.cart, KEY), false); assert.equal(Reflect.get(f.row().cart[KEY] as object, "state"), "released");
  assert.equal(f.reservation.status, "cancelled"); assert.equal(f.source().discount, 0); assert.equal(f.source().couponCode, null);
  assert.equal(f.outbox.length, 1);
  assert.equal(await storefrontCartHasCheckoutBinding(f.tx, "mrc_1", "cart_1"), false);
  const second = await f.repo.reopenForBuyerEdit("mrc_1", "chk_1", "payment");
  assert.equal(second.cart.currentDiscount, 0); assert.equal(f.outbox.length, 1);
  const expected = f.session(), next = structuredClone(expected); next.customer!.cpf = "12345678901";
  assert.equal((await f.repo.commitCommercialMutation({ expected, next })).customer?.cpf, "12345678901");
});
test("reapplying the same reservation id creates a fresh binding generation after validated released refresh", async () => {
  const f = fixture(true);
  await f.repo.reopenForBuyerEdit("mrc_1", "chk_1", "address");
  f.source().couponCode = "SAVE10"; f.source().discount = 500; f.reservation.status = "applied";
  f.reservation.discountApplied = new Prisma.Decimal(5); f.coupon.discountValue = new Prisma.Decimal(5);
  const expected = f.session(), next = structuredClone(expected);
  next.cart.currentDiscount = 5; next.cart.commercialNudge = { kind: "coupon", title: "Cupom aplicado", message: "Reaplicado", couponCode: "SAVE10" };
  const refreshed = await f.repo.commitCommercialMutation({ expected, next });
  assert.equal(refreshed.cart.currentDiscount, 5);
  const reopened = await f.repo.reopenForBuyerEdit("mrc_1", "chk_1", "address");
  assert.equal(reopened.cart.currentDiscount, 5);
  assert.equal(f.source().discount, 500); assert.equal(f.reservation.status, "applied");
  assert.equal(f.outbox.length, 1);
  const snapshot = { id: "payment_2", merchantId: "mrc_1", sessionId: "chk_1", idempotencyKey: "key2", version: 0, status: "pending" as const,
    method: "pix" as const, currency: "BRL", amountCents: 9599, statusHistory: [],
    amountBreakdown: { version: 1 as const, currency: "BRL" as const, itemsSubtotalCents: 10000, discountCents: 500, shippingCents: 0,
      platformFeeCents: 99, totalCents: 9599, cartFingerprint: paymentCartFingerprint(refreshed) },
    creation: { state: "ready" as const, input: { intentId: "payment_2", merchantId: "mrc_1", sessionId: "chk_1", method: "pix" as const, amountCents: 9599, currency: "BRL" } } };
  const fresh = await captureStorefrontCouponForPayment(f.tx, snapshot, { merchantId: "mrc_1", checkoutSessionId: "chk_1", cartId: "cart_1", buyerId: "usr_1" });
  assert.ok(fresh); assert.notEqual(fresh.bindingId, "11111111-1111-4111-8111-111111111111");
  assert.equal(fresh.redemptionId, "reservation_1"); assert.equal(fresh.discountCents, 500); assert.equal(f.outbox.length, 1);
});
for (const condition of ["pending", "uncertain", "paid", "source CAS failure"] as const) test(`reopen never releases on ${condition}`, async () => {
  const f = fixture(true);
  if (condition === "pending") f.payments[0].status = "pending";
  if (condition === "uncertain") Reflect.set(f.payments[0].creation as object, "state", "uncertain");
  if (condition === "paid") f.paid();
  if (condition === "source CAS failure") f.sourceCasFailure();
  await assert.rejects(f.repo.reopenForBuyerEdit("mrc_1", "chk_1", "payment"));
  assert.equal(f.source().discount, 1000); assert.equal(f.reservation.status, "applied"); assert.equal(f.outbox.length, 0);
  assert.equal(Reflect.get(f.row().cart[KEY] as object, "state"), "active");
});
