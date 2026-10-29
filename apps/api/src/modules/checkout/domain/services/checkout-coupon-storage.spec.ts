import assert from "node:assert/strict";
import test from "node:test";
import type { Cart } from "@zyon/shared-types";
import {
  assertNoCheckoutCouponBindingInput, hasStoredCheckoutCouponBinding,
  preserveStoredCheckoutCouponBinding, readStoredCheckoutCouponBinding,
  stripStoredCheckoutCouponBinding,
} from "./checkout-coupon-storage.js";

const key = "_storefrontCouponBinding";
const scope = { merchantId: "merchant", sessionId: "checkout", buyerId: "buyer" };
const binding = { version: 1, bindingId: "11111111-1111-4111-8111-111111111111",
  merchantId: "merchant", checkoutSessionId: "checkout", cartId: "cart", buyerId: "buyer", reservationBuyerId: null,
  couponId: "coupon", redemptionId: "redemption", discountCents: 137, basisHash: "ab".repeat(32), state: "active" };
const cart = (): Cart => ({ cart_ref: "cart", currency: "BRL", source: "storefront", total: 10, currentDiscount: 1.37,
  items: [{ sku: "sku", name: "Item", price: 10, quantity: 1 }] });
const stored = () => ({ ...cart(), [key]: structuredClone(binding) });
const conflict = (work: () => unknown) => assert.throws(work, (error: unknown) => {
  assert.ok(error instanceof Error);
  assert.equal(error.message, "checkout_coupon_binding_conflict");
  assert.equal("cause" in error, false);
  assert.equal(String(error).includes("PRIVATE_CANARY"), false);
  return true;
});

test("strip detaches the cart and omits valid and corrupt private metadata without inspecting its payload", () => {
  for (const value of [binding, undefined, null, "PRIVATE_CANARY", { token: "PRIVATE_CANARY" }]) {
    const raw = { ...cart(), [key]: value };
    const clean = stripStoredCheckoutCouponBinding(raw);
    assert.deepEqual(clean, cart());
    clean.items[0]!.name = "Detached";
    assert.equal(raw.items[0]!.name, "Item");
    assert.equal(Object.hasOwn(clean, key), false);
    assert.equal(Object.hasOwn(raw, key), true);
  }
});

test("presence is independent of validity and public inputs cannot contain the reserved key", () => {
  assert.equal(hasStoredCheckoutCouponBinding(cart()), false);
  assert.doesNotThrow(() => assertNoCheckoutCouponBindingInput(cart()));
  for (const value of [binding, undefined, null, "PRIVATE_CANARY"]) {
    const raw = { ...cart(), [key]: value };
    assert.equal(hasStoredCheckoutCouponBinding(raw), true);
    conflict(() => assertNoCheckoutCouponBindingInput(raw));
  }
});

test("read validates only present binding values and returns detached canonical snapshots", () => {
  assert.equal(readStoredCheckoutCouponBinding(cart()), undefined);
  const raw = stored(), parsed = readStoredCheckoutCouponBinding(raw);
  assert.deepEqual(parsed, binding);
  assert.notEqual(parsed, raw[key]);
  for (const value of [undefined, null, "PRIVATE_CANARY", { ...binding, extra: "PRIVATE_CANARY" }]) {
    conflict(() => readStoredCheckoutCouponBinding({ ...cart(), [key]: value }));
  }
});

test("preserve cannot issue a binding and preserves the raw canonical value without mutating public snapshots", () => {
  const raw = stored(), next = cart(), before = structuredClone(raw);
  const result = preserveStoredCheckoutCouponBinding(raw, next, scope);
  assert.deepEqual(result, before);
  assert.deepEqual(raw, before);
  assert.equal(Object.hasOwn(next, key), false);
  assert.deepEqual(preserveStoredCheckoutCouponBinding(cart(), next, scope), next);
  conflict(() => preserveStoredCheckoutCouponBinding(cart(), stored(), scope));
  conflict(() => preserveStoredCheckoutCouponBinding(raw, stored(), scope));
});

for (const field of ["merchantId", "sessionId", "buyerId"] as const) {
  test(`preserve rejects mismatched ${field}`, () => {
    conflict(() => preserveStoredCheckoutCouponBinding(stored(), cart(), { ...scope, [field]: "other" }));
  });
}

test("preserve rejects public origin, financial, provenance and identity mutations", () => {
  const cases: Cart[] = [
    { ...cart(), cart_ref: "other" }, { ...cart(), total: 11 }, { ...cart(), currency: "USD" },
    { ...cart(), currentDiscount: 1.38 }, { ...cart(), currentDiscount: 0 },
    { ...cart(), items: [{ ...cart().items[0]!, price: 9 }] },
    { ...cart(), items: [{ ...cart().items[0]!, sku: "other" }] },
    { ...cart(), items: [{ ...cart().items[0]!, quantity: 2 }] },
    { ...cart(), commercialNudge: { kind: "coupon", title: "Changed", message: "Changed", couponCode: "OTHER" } },
  ];
  for (const next of cases) conflict(() => preserveStoredCheckoutCouponBinding(stored(), next, scope));
  conflict(() => preserveStoredCheckoutCouponBinding({ ...stored(), cart_ref: "other" }, cart(), scope));
  conflict(() => preserveStoredCheckoutCouponBinding({ ...stored(), currentDiscount: 0 }, { ...cart(), currentDiscount: 0 }, scope));
});

test("released tombstones remain closed without restoring their historic discount", () => {
  const next = { ...cart(), currentDiscount: 0 };
  const raw = { ...next, [key]: { ...binding, state: "released" } };
  assert.deepEqual(preserveStoredCheckoutCouponBinding(raw, next, scope), raw);
  conflict(() => preserveStoredCheckoutCouponBinding(raw, cart(), scope));
});

test("redeemed bindings remain bound to the same order and cannot be removed by a public save", () => {
  const raw = { ...stored(), [key]: { ...binding, state: "redeemed", orderId: "order" } };
  assert.deepEqual(preserveStoredCheckoutCouponBinding(raw, cart(), scope), raw);
  conflict(() => preserveStoredCheckoutCouponBinding(raw, { ...cart(), currentDiscount: 0 }, scope));
});

test("hostile metadata yields only the fixed conflict, never a raw payload", () => {
  const hostile = new Proxy({}, { has() { throw new Error("PRIVATE_CANARY"); }, get() { throw new Error("PRIVATE_CANARY"); }, ownKeys() { throw new Error("PRIVATE_CANARY"); } });
  conflict(() => readStoredCheckoutCouponBinding(hostile));
  conflict(() => preserveStoredCheckoutCouponBinding(hostile, cart(), scope));
  conflict(() => assertNoCheckoutCouponBindingInput(hostile));
});
