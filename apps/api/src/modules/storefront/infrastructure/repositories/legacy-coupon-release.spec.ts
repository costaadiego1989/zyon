import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PrismaStorefrontCartRepository } from "./prisma-storefront-cart.repository.js";
import type { StorefrontCart } from "../../domain/ports/storefront-cart.port.js";

// Transaction/delegate doubles prove control flow only, not native SQL isolation.
const merchantId = "legacy-release-merchant", sessionId = "legacy-release-cart";
const initial = (): StorefrontCart => ({ id: "legacy-release-row", merchantId, sessionId,
  items: [{ variantId: "variant", productId: "product", sku: "SYNTHETIC", name: "Saved", quantity: 2, unitPriceCents: 9000 }],
  total: 18000, discount: 1000, couponCode: "SAVED", freeShipping: false, createdAt: new Date(0), updatedAt: new Date(0) });
const reservation = () => ({ id: "redemption", merchantId, sessionId, couponId: "coupon", status: "applied", orderId: null as string | null,
  buyerGlobalUserId: "reservation-buyer" as string | null, discountApplied: new Prisma.Decimal(10) });
type Options = { source?: Partial<StorefrontCart>; redemption?: Partial<ReturnType<typeof reservation>>; missing?: boolean;
  multiple?: boolean; coupon?: Record<string, unknown>; checkout?: "prepayment" | "uncertain" | "paid";
  bound?: boolean; sourceChanged?: boolean; fail?: "read" | "cancel" | "write" | "commit" | "ack"; cas?: number; sourceCas?: number };
function fixture(options: Options = {}) {
  const calls: string[] = [], failure = new Error(`synthetic-${options.fail ?? "failure"}`);
  let stored = structuredClone({ ...initial(), ...options.source });
  let savedRedemption = { ...reservation(), ...options.redemption };
  let current = structuredClone(stored), currentRedemption = { ...savedRedemption };
  const coupon = { id: "coupon", merchantId, code: "SAVED", discountType: "fixed", strategyIncentiveExecutionId: null, status: "expired", ...options.coupon };
  const tx = {
    async $executeRaw() { calls.push("cart-lock"); return 1; },
    async $queryRaw(parts: TemplateStringsArray, ...values: unknown[]) {
      const sql = parts.join("?");
      if (sql.includes("current_setting")) {
        calls.push("owner-read");
        const binding = { version: 1, bindingId: "11111111-1111-4111-8111-111111111111", merchantId, cartId: sessionId,
          checkoutSessionId: "bound-checkout", buyerId: "buyer", reservationBuyerId: "reservation-buyer", redemptionId: "redemption",
          couponId: "coupon", discountCents: 1000, basisHash: "ab".repeat(32), state: "active" };
        return [{ isolation: "read committed", candidates: options.bound ? [{ merchantId, sessionId: "bound-checkout", buyerId: "buyer", cartRef: sessionId, binding }] : [] }];
      }
      if (sql.includes("FROM checkout_sessions")) {
        calls.push("legacy-checkout-read"); assert.deepEqual(values, [merchantId, sessionId]);
        return options.checkout ? [{ id: "legacy-checkout" }] : [];
      }
      if (sql.includes("FROM coupons")) { calls.push("coupon-lock"); assert.deepEqual(values, [merchantId, "SAVED"]); return [{ id: "coupon" }]; }
      assert.fail("unexpected_release_sql");
    },
    storefrontCart: {
      async upsert() { calls.push("upsert"); return structuredClone(current); },
      async findUnique() { calls.push("source-read"); if (options.fail === "read") throw failure;
        return structuredClone({ ...current, ...(options.sourceChanged ? { discount: 999 } : {}) }); },
      async update(input: { data: Partial<StorefrontCart> }) { calls.push("source-write"); if (options.fail === "write") throw failure;
        current = { ...current, ...structuredClone(input.data) }; return structuredClone(current); },
      async updateMany(input: { where: Record<string, unknown>; data: Partial<StorefrontCart> }) {
        calls.push("source-write"); if (options.fail === "write") throw failure;
        assert.equal(input.where.id, stored.id); assert.equal(input.where.merchantId, merchantId); assert.equal(input.where.sessionId, sessionId);
        assert.equal(input.where.discount, stored.discount); assert.equal(input.where.couponCode, stored.couponCode);
        assert.deepEqual(input.where.updatedAt, stored.updatedAt); assert.deepEqual(input.where.items, { equals: stored.items });
        if (options.sourceCas === 0) return { count: 0 };
        current = { ...current, ...structuredClone(input.data) }; return { count: 1 };
      },
    },
    coupon: { async findFirst() { calls.push("coupon-read"); return { ...coupon }; } },
    couponRedemption: {
      async findMany() { calls.push("reservations-read"); return options.missing ? [] : options.multiple ? [{ ...currentRedemption }, { ...currentRedemption, id: "second" }] : [{ ...currentRedemption }]; },
      async findFirst() { calls.push("reservation-read"); return { ...currentRedemption }; },
      async updateMany(input: { where: Record<string, unknown>; data: { status: string } }) {
        calls.push("cancel"); if (options.fail === "cancel") throw failure;
        assert.equal(input.where.merchantId, merchantId); assert.equal(input.where.sessionId, sessionId);
        assert.equal(input.where.id, "redemption"); assert.equal(input.where.couponId, "coupon");
        assert.equal(input.where.buyerGlobalUserId, savedRedemption.buyerGlobalUserId);
        assert.equal(input.where.status, "applied"); assert.equal(input.where.orderId, null);
        assert.ok(Prisma.Decimal.isDecimal(input.where.discountApplied));
        if (options.cas === 0) return { count: 0 };
        currentRedemption = { ...currentRedemption, ...input.data }; return { count: 1 };
      },
    },
    productVariant: { async findFirst() { assert.fail("release_must_not_authorize_from_catalog"); } },
    merchantRule: { async findUnique() { assert.fail("release_must_not_authorize_from_policy"); } },
    paymentIntent: { async findMany() { assert.fail("legacy_checkout_presence_is_already_review"); } },
  };
  const prisma = { async $transaction<T>(work: (client: Prisma.TransactionClient) => Promise<T>) {
    current = structuredClone(stored); currentRedemption = { ...savedRedemption }; calls.push("begin");
    try {
      const result = await work(tx as unknown as Prisma.TransactionClient);
      if (options.fail === "commit") throw failure;
      stored = structuredClone(current); savedRedemption = { ...currentRedemption }; calls.push("commit");
      if (options.fail === "ack") throw failure;
      return result;
    } catch (error) { calls.push("error"); throw error; }
  } } as unknown as PrismaClient;
  return { repository: new PrismaStorefrontCartRepository(prisma), calls, failure,
    saved: () => structuredClone(stored), redemption: () => ({ ...savedRedemption }) };
}
type F = ReturnType<typeof fixture>;
const operations = [
  ["removeCoupon", (f: F) => f.repository.removeCoupon(merchantId, sessionId)],
  ["clear", (f: F) => f.repository.clear(merchantId, sessionId)],
  ["remove-last", (f: F) => f.repository.removeItem(merchantId, sessionId, "variant")],
] as const;
for (const [name, mutate] of operations) {
  test(`legacy ${name} cancels the exact positive reservation and source in one transaction`, async () => {
    const f = fixture(), before = f.saved(), result = await mutate(f);
    assert.equal(f.redemption().status, "cancelled"); assert.equal(result.couponCode, null); assert.equal(result.discount, 0);
    assert.equal(f.saved().couponCode, null); assert.equal(f.saved().discount, 0);
    if (name === "removeCoupon") { assert.deepEqual(result.items, before.items); assert.equal(result.total, before.total); }
    else { assert.deepEqual(result.items, []); assert.equal(result.total, 0); }
    assert.ok(f.calls.indexOf("cart-lock") < f.calls.indexOf("coupon-lock"));
    assert.ok(f.calls.indexOf("cancel") < f.calls.indexOf("source-write"));
    assert.equal(f.calls.filter(call => call === "begin").length, 1); assert.equal(f.calls.filter(call => call === "cancel").length, 1);
  });
  for (const [suffix, options] of [
    ["missing reservation", { missing: true }], ["multiple reservations", { multiple: true }],
    ["redeemed", { redemption: { status: "redeemed", orderId: "paid-order" } }], ["order linked", { redemption: { orderId: "order" } }],
    ["different D", { redemption: { discountApplied: new Prisma.Decimal(9.99) } }],
    ["fractional cent", { redemption: { discountApplied: new Prisma.Decimal(10.001) } }],
    ["foreign reservation", { redemption: { merchantId: "foreign" } }],
    ["foreign coupon", { coupon: { merchantId: "foreign" } }], ["changed source", { sourceChanged: true }],
    ["zero merchandise contribution", { source: { discount: 0 } }], ["freight-only coupon", { coupon: { discountType: "shipping_free" } }],
    ["mixed shipping attribution", { source: { freeShipping: true } }], ["CAS loser", { cas: 0 }], ["source CAS loser", { sourceCas: 0 }],
    ["malformed stored subtotal", { source: { total: 17000 } }], ["contribution exceeding source", { source: { discount: 19000 } }],
    ["strategy-owned coupon", { coupon: { strategyIncentiveExecutionId: "strategy-execution" } }],
    ["legacy checkout before payment", { checkout: "prepayment" }], ["legacy checkout uncertain", { checkout: "uncertain" }],
    ["legacy checkout paid", { checkout: "paid" }], ["bound checkout", { bound: true }],
  ] as Array<[string, Options]>) test(`legacy ${name} refuses ${suffix} without losing source or reservation`, async () => {
    const f = fixture(options), before = f.saved(), reserved = f.redemption();
    await assert.rejects(mutate(f)); assert.deepEqual(f.saved(), before); assert.deepEqual(f.redemption(), reserved);
    assert.ok(!f.calls.includes("commit"));
  });
  for (const fail of ["read", "cancel", "write", "commit"] as const) test(`legacy ${name} propagates ${fail} failure and rolls back`, async () => {
    const f = fixture({ fail }), before = f.saved(), reserved = f.redemption();
    await assert.rejects(mutate(f), error => error === f.failure);
    assert.deepEqual(f.saved(), before); assert.deepEqual(f.redemption(), reserved);
    assert.equal(f.calls.filter(call => call === "begin").length, 1);
  });
}
test("legacy release propagates lost commit acknowledgement without automatic retry or invented receipt", async () => {
  const f = fixture({ fail: "ack" });
  await assert.rejects(f.repository.removeCoupon(merchantId, sessionId), error => error === f.failure);
  assert.equal(f.saved().couponCode, null); assert.equal(f.redemption().status, "cancelled");
  assert.equal(f.calls.filter(call => call === "cancel").length, 1); assert.equal(f.calls.filter(call => call === "begin").length, 1);
});
test("legacy coupon GET preserves reservation and never invokes release proof", async () => {
  const f = fixture(), before = f.saved(), reserved = f.redemption();
  const result = await f.repository.getOrCreate(merchantId, sessionId);
  assert.equal(result.couponCode, before.couponCode); assert.equal(result.discount, before.discount);
  assert.deepEqual(f.redemption(), reserved); assert.ok(!f.calls.includes("coupon-lock"));
});
