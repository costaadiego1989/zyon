import assert from "node:assert/strict";
import test from "node:test";
import { prepareStorefrontCouponComposition, storefrontCouponCompositionResultSchema } from "./storefront-coupon-composition.js";
import { merchantRules, testCart } from "../../../checkout/__tests__/checkout-test-fixtures.js";
import type { CouponSnapshot } from "../entities/coupon.entity.js";
import { validateCoupon } from "./coupon-validity.policy.js";

function fixture() {
  const coupon: CouponSnapshot = { id: "coupon", merchant_id: "merchant", code: "TEST", discount_type: "percent", discount_value: 10,
    min_cart_total: null, max_usages: 100, max_per_buyer: null, usages_count: 0, allowed_skus: [], blocked_skus: [], allowed_regions: [], blocked_regions: [],
    status: "active", starts_at: "2020-01-01T00:00:00.000Z", ends_at: null, created_at: "2020-01-01T00:00:00.000Z", updated_at: "2020-01-01T00:00:00.000Z" };
  return { now: "2026-10-20T12:00:00.000Z", scope: { merchantId: "merchant", cartId: "cart", buyerId: "buyer" }, coupon,
    reservation: { id: "reserve", merchantId: "merchant", cartId: "cart", buyerId: null as string | null, couponId: "coupon", discountCents: 800, status: "applied" },
    cart: { currency: "BRL", total: 90, currentDiscount: 8, items: [{ sku: "SKU", variantId: "variant", product_id: "product", name: "P+D", quantity: 3, price: 30, originalPrice: 35 }],
      discountBudget: { version: 1, originalSubtotalCents: 10500, promotionDiscountCents: 1500 } },
    rules: merchantRules({ maxDiscountPercent: 30, allowStackDiscountAndFreeShipping: true, freeShippingMinCartValue: 10 }),
    shipping: { quoteKey: "quote", destination: "address-fingerprint", expiresAt: "2999-01-01T00:00:00.000Z", customerPrice: 10, realCost: 12, region: "SP" } };
}

test("preserves exact D and existing product/addition promotion, without applying twice", () => {
  const f = fixture(), before = structuredClone(f), result = prepareStorefrontCouponComposition(f);
  assert.equal(result.kind, "candidate"); if (result.kind !== "candidate") return;
  assert.equal(result.merchandiseDiscountCents, 800); assert.equal(result.promotionDiscountCents, 1500);
  assert.equal(result.merchandiseTotalCents, 8200); assert.equal(result.totalCents, 9200);
  assert.equal(result.couponId, "coupon"); assert.equal(result.redemptionId, "reserve");
  assert.equal(result.shippingDiscountCents, 0); assert.equal(result.version, 2);
  assert.deepEqual(f, before); assert.deepEqual(prepareStorefrontCouponComposition(f), result);
  assert.equal(Object.hasOwn(result, "bindingId"), false); assert.equal(Object.hasOwn(result, "authorized"), false);
});

test("company ceiling exactly attained yields existing customer notice without erasing reservation", () => {
  const f = fixture(); f.rules.maxDiscountPercent = 20; f.reservation.discountCents = 600; f.cart.currentDiscount = 6;
  const result = prepareStorefrontCouponComposition(f); assert.equal(result.kind, "candidate");
  if (result.kind === "candidate") assert.equal(result.commercialNotices?.[0]?.code, "discount_limit_reached");
  assert.equal(f.reservation.discountCents, 600);
});

test("lower ceiling requires review rather than truncating already reserved D", () => {
  const f = fixture(); f.rules.maxDiscountPercent = 20;
  const result = prepareStorefrontCouponComposition(f); assert.equal(result.kind, "requires_review");
  if (result.kind === "requires_review") assert.equal(result.reason, "discount_ceiling_changed");
  assert.equal(f.reservation.discountCents, 800); assert.equal(f.cart.currentDiscount, 8);
});

for (const type of ["shipping_free", "shipping_percent", "shipping_fixed"] as const) test("distinct shipping contribution for " + type + " with exact merchandise D0", () => {
  const f = fixture(); f.coupon.discount_type = type; f.coupon.discount_value = type === "shipping_percent" ? 50 : 5;
  f.cart.currentDiscount = 0; f.reservation.discountCents = 0;
  const result = prepareStorefrontCouponComposition(f); assert.equal(result.kind, "candidate"); if (result.kind !== "candidate") return;
  const d = type === "shipping_free" ? 1000 : 500;
  assert.equal(result.merchandiseDiscountCents, 0); assert.equal(result.shippingDiscountCents, d);
  assert.equal(result.shippingOriginalPriceCents, 1000); assert.equal(result.shippingPriceCents, 1000 - d);
  assert.equal(result.totalCents, 10000 - d); assert.equal(result.shippingQuote?.quoteKey, "quote");
  assert.equal(result.promotionDiscountCents, 1500);
});

test("promotion-only savings still trigger explicit shipping stacking rule when D0", () => {
  const f = fixture(); f.coupon.discount_type = "shipping_free"; f.cart.currentDiscount = 0; f.reservation.discountCents = 0;
  f.rules.allowStackDiscountAndFreeShipping = false;
  const result = prepareStorefrontCouponComposition(f); assert.equal(result.kind, "requires_review");
  if (result.kind === "requires_review") assert.equal(result.reason, "shipping_stacking_changed");
});

for (const [name, mutate] of [
  ["subsidy", (f: ReturnType<typeof fixture>) => { f.rules.maxShippingSubsidy = 2; }],
  ["partial limit", (f: ReturnType<typeof fixture>) => { f.rules.maxPartialShippingDiscount = 2; }],
  ["free disabled", (f: ReturnType<typeof fixture>) => { f.rules.allowFreeShipping = false; f.coupon.discount_value = 100; }],
  ["discount disabled", (f: ReturnType<typeof fixture>) => { f.rules.allowShippingDiscount = false; }],
  ["blocked region", (f: ReturnType<typeof fixture>) => { f.rules.blockedRegions = ["SP"]; }],
  ["missing region", (f: ReturnType<typeof fixture>) => { f.rules.blockedRegions = ["RJ"]; Reflect.deleteProperty(f.shipping, "region"); }],
  ["free minimum", (f: ReturnType<typeof fixture>) => { f.rules.freeShippingMinCartValue = 200; f.coupon.discount_value = 100; }],
  ["quote expired", (f: ReturnType<typeof fixture>) => { f.shipping.expiresAt = "2000-01-01T00:00:00.000Z"; }],
] as const) test("shipping policy review retains original data: " + name, () => {
  const f = fixture(); f.coupon.discount_type = "shipping_percent"; f.coupon.discount_value = 50; f.cart.currentDiscount = 0; f.reservation.discountCents = 0;
  mutate(f); const before = structuredClone(f); assert.equal(prepareStorefrontCouponComposition(f).kind, "requires_review"); assert.deepEqual(f, before);
});

for (const mutate of [
  (f: ReturnType<typeof fixture>) => { f.coupon.status = "paused"; },
  (f: ReturnType<typeof fixture>) => { f.coupon.ends_at = "2000-01-01T00:00:00.000Z"; },
  (f: ReturnType<typeof fixture>) => { f.coupon.min_cart_total = 1000; },
  (f: ReturnType<typeof fixture>) => { f.coupon.allowed_skus = ["OTHER"]; },
  (f: ReturnType<typeof fixture>) => { f.coupon.allowed_regions = ["RJ"]; },
  (f: ReturnType<typeof fixture>) => { f.coupon.discount_value = 1; },
]) test("changed coupon eligibility cannot silently reprice reservation " + String(mutate), () => {
  const f = fixture(); mutate(f); assert.equal(prepareStorefrontCouponComposition(f).kind, "requires_review");
});

for (const [name, mutate] of [
  ["foreign merchant", (f: ReturnType<typeof fixture>) => { f.coupon.merchant_id = "foreign"; }],
  ["foreign source", (f: ReturnType<typeof fixture>) => { f.reservation.cartId = "foreign"; }],
  ["foreign buyer", (f: ReturnType<typeof fixture>) => { f.reservation.buyerId = "foreign"; }],
  ["foreign coupon", (f: ReturnType<typeof fixture>) => { f.reservation.couponId = "foreign"; }],
  ["wrong D", (f: ReturnType<typeof fixture>) => { f.reservation.discountCents = 799; }],
  ["cancelled", (f: ReturnType<typeof fixture>) => { f.reservation.status = "cancelled"; }],
  ["strategy", (f: ReturnType<typeof fixture>) => { f.coupon.strategy_incentive_execution_id = "strategy"; }],
  ["total", (f: ReturnType<typeof fixture>) => { f.cart.total = 91; }],
  ["budget", (f: ReturnType<typeof fixture>) => { f.cart.discountBudget.originalSubtotalCents++; }],
  ["original unit", (f: ReturnType<typeof fixture>) => { f.cart.items[0]!.originalPrice = 36; }],
  ["cent precision", (f: ReturnType<typeof fixture>) => { f.cart.items[0]!.price = 30.001; }],
  ["private input", (f: ReturnType<typeof fixture>) => { Reflect.set(f, "_authority", true); }],
] as const) test("fixed integrity error without authority grant: " + name, () => {
  const f = fixture(); mutate(f); assert.throws(() => prepareStorefrontCouponComposition(f), /^Error: storefront_coupon_composition_conflict$/);
});

test("absence of cost and impossible informational margin do not affect candidate", () => {
  const f = fixture(), first = prepareStorefrontCouponComposition(f); f.rules.minimumMarginPercent = 100;
  assert.deepEqual(prepareStorefrontCouponComposition(f), first);
});

test("shipping-only cannot smuggle a merchandise discount", () => {
  const f = fixture(); f.coupon.discount_type = "shipping_free";
  assert.throws(() => prepareStorefrontCouponComposition(f), /storefront_coupon_composition_conflict/);
});

test("fractional percent shipping is rounded by existing calculator to exact cents", () => {
  const f = fixture(); f.coupon.discount_type = "shipping_percent"; f.coupon.discount_value = 33.33;
  f.cart.currentDiscount = 0; f.reservation.discountCents = 0; f.shipping.customerPrice = 10.01;
  const result = prepareStorefrontCouponComposition(f); assert.equal(result.kind, "candidate");
  if (result.kind === "candidate") { assert.equal(result.shippingDiscountCents, 333); assert.equal(result.shippingPriceCents, 668); }
});

test("fixed coupon preserves reserved amount rather than taking a new larger grant", () => {
  const f = fixture(); f.coupon.discount_type = "fixed"; f.coupon.discount_value = 20; f.reservation.buyerId = "buyer";
  const result = prepareStorefrontCouponComposition(f); assert.equal(result.kind, "candidate");
  if (result.kind === "candidate") { assert.equal(result.merchandiseDiscountCents, 800); assert.equal(result.reservationBuyerId, "buyer"); }
});

test("promotion-free D0 with stacking disabled still permits an eligible shipping coupon", () => {
  const f = fixture(); f.coupon.discount_type = "shipping_free"; f.cart.currentDiscount = 0; f.reservation.discountCents = 0;
  f.cart.items[0]!.originalPrice = 30; f.cart.discountBudget = { version: 1, originalSubtotalCents: 9000, promotionDiscountCents: 0 };
  f.rules.allowStackDiscountAndFreeShipping = false; f.rules.maxDiscountPercent = 0;
  const result = prepareStorefrontCouponComposition(f); assert.equal(result.kind, "candidate");
  if (result.kind === "candidate") { assert.equal(result.shippingDiscountCents, 1000); assert.equal(result.merchandiseDiscountCents, 0); }
});

test("goods coupon can be evaluated before carrier quote without asserting free shipping", () => {
  const f = fixture(); Reflect.deleteProperty(f, "shipping");
  const result = prepareStorefrontCouponComposition(f); assert.equal(result.kind, "candidate");
  if (result.kind === "candidate") { assert.equal(result.shippingQuote, undefined); assert.equal(result.totalCents, 8200); }
});

test("shipping coupon without real carrier quote requires review, not synthetic price", () => {
  const f = fixture(); f.coupon.discount_type = "shipping_free"; f.cart.currentDiscount = 0; f.reservation.discountCents = 0; Reflect.deleteProperty(f, "shipping");
  assert.equal(prepareStorefrontCouponComposition(f).kind, "requires_review");
});

test("percentage precision is not incorrectly validated as currency precision", () => {
  const f = fixture(); f.coupon.discount_type = "shipping_percent"; f.coupon.discount_value = 33.333;
  f.cart.currentDiscount = 0; f.reservation.discountCents = 0;
  const result = prepareStorefrontCouponComposition(f); assert.equal(result.kind, "candidate");
  if (result.kind === "candidate") assert.equal(result.shippingDiscountCents, 333);
});

for (const [name, patch] of [
  ["wrong total", { totalCents: 0 }], ["wrong merchandise", { merchandiseTotalCents: 0 }],
  ["wrong shipping", { shippingPriceCents: 1 }], ["fake free-shipping grant", { benefit: "shipping" }],
  ["raw provenance", { _reservation: "secret" }], ["foreign buyer", { reservationBuyerId: "foreign" }],
] as const) test("structured output denies " + name, () => {
  const good = prepareStorefrontCouponComposition(fixture());
  assert.equal(storefrontCouponCompositionResultSchema.safeParse({ ...good, ...patch }).success, false);
});

test("throwing input proxy receives fixed safe error", () => {
  assert.throws(() => prepareStorefrontCouponComposition(new Proxy({}, { get() { throw new Error("private-secret"); } })),
    error => error instanceof Error && error.message === "storefront_coupon_composition_conflict" && !Object.hasOwn(error, "cause"));
});

for (const unknownMargin of [undefined, null, Number.NaN, -100, "unknown"]) test("informational margin never blocks candidate: " + String(unknownMargin), () => {
  const f = fixture(), expected = prepareStorefrontCouponComposition(f);
  if (unknownMargin === undefined) Reflect.deleteProperty(f.rules, "minimumMarginPercent");
  else Reflect.set(f.rules, "minimumMarginPercent", unknownMargin);
  assert.deepEqual(prepareStorefrontCouponComposition(f), expected);
});

test("one explicit canonical clock preserves existing coupon start/end boundaries", () => {
  const f = fixture(); f.coupon.starts_at = f.now; f.coupon.ends_at = f.now;
  assert.equal(prepareStorefrontCouponComposition(f).kind, "candidate");
  f.now = "2026-10-20T11:59:59.999Z"; assert.equal(prepareStorefrontCouponComposition(f).kind, "requires_review");
  f.now = "2026-10-20T12:00:00.001Z"; assert.equal(prepareStorefrontCouponComposition(f).kind, "requires_review");
});

test("shipping quote expires at exact canonical clock, independent of wall clock", () => {
  const f = fixture(); f.coupon.discount_type = "shipping_free"; f.cart.currentDiscount = 0; f.reservation.discountCents = 0;
  f.shipping.expiresAt = "2026-10-20T12:00:00.001Z";
  const before = prepareStorefrontCouponComposition(f); assert.equal(before.kind, "candidate");
  assert.deepEqual(prepareStorefrontCouponComposition(f), before);
  f.now = f.shipping.expiresAt; const expired = prepareStorefrontCouponComposition(f); assert.equal(expired.kind, "requires_review");
  if (expired.kind === "requires_review") assert.equal(expired.reason, "shipping_conditions_changed");
});

test("existing validity policy rejects an invalid supplied clock instead of bypassing windows", () => {
  assert.deepEqual(validateCoupon(fixture().coupon, testCart(), undefined, new Date(Number.NaN)), { valid: false, reason: "COUPON_INVALID" });
});
