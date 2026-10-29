import assert from "node:assert/strict";
import test from "node:test";
import { parseShippingCouponBinding, parseShippingCouponPaymentAuthority, parseShippingCouponOrderAuthority, shippingCouponRedemptionPlanSchema, assertShippingCouponBindingPreserved,
  planShippingCouponRedemption } from "./shipping-coupon-handoff.js";
import { parseCheckoutCouponPaymentAuthority } from "../../../checkout/domain/services/checkout-coupon-binding.js";

function fixture() {
  const identity = { version: 2, bindingId: "11111111-1111-4111-8111-111111111111", merchantId: "merchant", cartId: "cart", checkoutSessionId: "checkout",
    buyerId: "buyer", reservationBuyerId: null as string | null, couponId: "coupon", redemptionId: "redemption", discountCents: 0, basisHash: "ab".repeat(32),
    shipping: { quoteKey: "quote", destination: "address-fingerprint", expiresAt: "2020-01-01T00:00:00.000Z", originalPriceCents: 1000, realCostCents: 1200,
      discountCents: 500, priceCents: 500 } };
  return { identity, binding: { ...identity, state: "active" }, orderAuthority: { ...identity, orderId: "order" },
    redemption: { id: "redemption", merchantId: "merchant", sessionId: "cart", couponId: "coupon", buyerGlobalUserId: null as string | null,
      discountCents: 0, status: "applied", orderId: null as string | null } };
}
function plan(f: ReturnType<typeof fixture>) {
  const { binding, orderAuthority, redemption } = f;
  return planShippingCouponRedemption({ binding, orderAuthority, redemption });
}

test("V2 preserves genuine D0 and separate exact freight contribution, not fake item discount", () => {
  const f = fixture(), result = parseShippingCouponPaymentAuthority(f.identity);
  assert.deepEqual(result, f.identity); assert.notEqual(result, f.identity); assert.notEqual(result.shipping, f.identity.shipping);
  result.shipping.discountCents = 900; assert.equal(f.identity.shipping.discountCents, 500);
  assert.throws(() => parseCheckoutCouponPaymentAuthority(f.identity), /checkout_coupon_binding_conflict/);
  assert.equal(parseShippingCouponBinding(f.binding).state, "active");
});

test("plan uses frozen source and D0, never current live cart nor expiry at paid redemption", () => {
  const f = fixture(), result = plan(f);
  assert.deepEqual(result, { version: 2, kind: "redeem", merchantId: "merchant", checkoutSessionId: "checkout", cartId: "cart",
    redemptionId: "redemption", couponId: "coupon", orderId: "order", discountCents: 0, shippingDiscountCents: 500 });
  assert.equal(f.redemption.status, "applied");
});

test("exact same paid order is idempotent while another order cannot consume source", () => {
  const f = fixture(); f.redemption.status = "redeemed"; f.redemption.orderId = "order";
  assert.equal(plan(f).kind, "already_redeemed");
  Reflect.set(f.binding, "orderId", "order"); f.binding.state = "redeemed";
  assert.equal(plan(f).kind, "already_redeemed");
  f.orderAuthority.orderId = "other"; assert.throws(() => plan(f), /shipping_coupon_binding_conflict/);
});

for (const [name, mutate] of [
  ["released", (f: ReturnType<typeof fixture>) => { f.binding.state = "released"; }],
  ["canceled", (f: ReturnType<typeof fixture>) => { f.redemption.status = "cancelled"; }],
  ["wrong source", (f: ReturnType<typeof fixture>) => { f.redemption.sessionId = "checkout"; }],
  ["wrong tenant", (f: ReturnType<typeof fixture>) => { f.redemption.merchantId = "other"; }],
  ["wrong coupon", (f: ReturnType<typeof fixture>) => { f.redemption.couponId = "other"; }],
  ["wrong redemption", (f: ReturnType<typeof fixture>) => { f.redemption.id = "other"; }],
  ["wrong buyer", (f: ReturnType<typeof fixture>) => { f.redemption.buyerGlobalUserId = "other"; }],
  ["fake goods cent", (f: ReturnType<typeof fixture>) => { f.redemption.discountCents = 1; }],
  ["different frozen freight", (f: ReturnType<typeof fixture>) => { f.orderAuthority.shipping = { ...f.orderAuthority.shipping, discountCents: 499, priceCents: 501 }; }],
  ["different frozen basis", (f: ReturnType<typeof fixture>) => { f.orderAuthority.basisHash = "cd".repeat(32); }],
  ["different generation", (f: ReturnType<typeof fixture>) => { f.orderAuthority.bindingId = "22222222-2222-4222-8222-222222222222"; }],
  ["uncommitted redemption", (f: ReturnType<typeof fixture>) => { f.binding.state = "redeemed"; Reflect.set(f.binding, "orderId", "order"); }],
] as const) test("no lifecycle plan for " + name, () => {
  const f = fixture(); mutate(f); assert.throws(() => plan(f), /^Error: shipping_coupon_binding_conflict$/);
});

for (const [name, mutate] of [
  ["legacy version", (x: ReturnType<typeof fixture>["identity"]) => { x.version = 1; }],
  ["positive goods D", (x: ReturnType<typeof fixture>["identity"]) => { x.discountCents = 1; }],
  ["zero shipping D", (x: ReturnType<typeof fixture>["identity"]) => { x.shipping.discountCents = 0; x.shipping.priceCents = 1000; }],
  ["negative shipping", (x: ReturnType<typeof fixture>["identity"]) => { x.shipping.priceCents = -1; }],
  ["different math", (x: ReturnType<typeof fixture>["identity"]) => { x.shipping.priceCents = 501; }],
  ["fractional cent", (x: ReturnType<typeof fixture>["identity"]) => { x.shipping.originalPriceCents = 1000.1; }],
  ["foreign reservation buyer", (x: ReturnType<typeof fixture>["identity"]) => { x.reservationBuyerId = "other"; }],
  ["caller provenance", (x: ReturnType<typeof fixture>["identity"]) => { Reflect.set(x, "authorized", true); }],
] as const) test("strict detached identity rejects " + name, () => {
  const f = fixture(); mutate(f.identity); assert.throws(() => parseShippingCouponPaymentAuthority(f.identity), /^Error: shipping_coupon_binding_conflict$/);
});

test("generic saves cannot introduce erase or transition V2", () => {
  const { binding } = fixture(); assertShippingCouponBindingPreserved(undefined, undefined); assertShippingCouponBindingPreserved(binding, structuredClone(binding));
  for (const [a, b] of [[undefined, binding], [binding, undefined], [binding, { ...binding, state: "released" }],
    [binding, { ...binding, shipping: { ...binding.shipping, destination: "other" } }]]) {
    assert.throws(() => assertShippingCouponBindingPreserved(a, b), /shipping_coupon_binding_conflict/);
  }
});

test("throwing proxy never exposes raw payload as cause", () => {
  const bad = new Proxy({}, { get() { throw new Error("private-secret"); } });
  assert.throws(() => parseShippingCouponPaymentAuthority(bad), error => error instanceof Error
    && error.message === "shipping_coupon_binding_conflict" && !Object.hasOwn(error, "cause"));
});

test("binding and order parsers also enforce matching reservation buyer", () => {
  const f = fixture(); f.binding.reservationBuyerId = "other"; f.orderAuthority.reservationBuyerId = "other";
  assert.throws(() => parseShippingCouponBinding(f.binding), /shipping_coupon_binding_conflict/);
  assert.throws(() => parseShippingCouponOrderAuthority(f.orderAuthority), /shipping_coupon_binding_conflict/);
});

test("journal authority cannot contain lifecycle or mutable order reference", () => {
  const f = fixture(); assert.throws(() => parseShippingCouponPaymentAuthority(f.binding), /shipping_coupon_binding_conflict/);
  assert.throws(() => parseShippingCouponPaymentAuthority(f.orderAuthority), /shipping_coupon_binding_conflict/);
  assert.throws(() => parseShippingCouponOrderAuthority({ ...f.orderAuthority, state: "active" }), /shipping_coupon_binding_conflict/);
});

test("structured redemption plan rejects fake goods discount and zero freight benefit", () => {
  const result = plan(fixture());
  assert.equal(shippingCouponRedemptionPlanSchema.safeParse({ ...result, discountCents: 1 }).success, false);
  assert.equal(shippingCouponRedemptionPlanSchema.safeParse({ ...result, shippingDiscountCents: 0 }).success, false);
  assert.equal(shippingCouponRedemptionPlanSchema.safeParse({ ...result, _binding: "private" }).success, false);
});
