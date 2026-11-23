import assert from "node:assert/strict";
import { test } from "node:test";
import { assertServiceCheckoutCreationCapability } from "./service-checkout-provenance.js";
import { paymentCartFingerprint } from "../../modules/checkout/domain/services/payment-cart-fingerprint.js";

test("T40 private creation capability", async t => {
  const identity = { merchantId: "merchant", sessionId: "checkout", globalUserId: "buyer" };
  const now = new Date("2035-01-01T12:00:00Z");
  const capability = { ...identity, allowedOrigin: "https://booking.example.test", expiresAtUnix: now.getTime() / 1000 + 10 };
  await t.test("legacy product creation without the private service capability keeps its contract", () => {
    assert.doesNotThrow(() => assertServiceCheckoutCreationCapability(identity, undefined, now));
  });
  await t.test("the original scoped buyer and session are admitted before their verified expiry", () => {
    assert.doesNotThrow(() => assertServiceCheckoutCreationCapability(identity, capability, now));
  });
  await t.test("a fresh database timestamp at or after expiry refuses creation", () => {
    for (const milliseconds of [capability.expiresAtUnix * 1000, capability.expiresAtUnix * 1000 + 1])
      assert.throws(() => assertServiceCheckoutCreationCapability(identity, capability, new Date(milliseconds)), /embed_session_token_expired/);
  });
  await t.test("merchant, nonce-derived session and first buyer cannot be changed", () => {
    for (const patch of [{ merchantId: "foreign" }, { sessionId: "foreign" }, { globalUserId: "foreign" }])
      assert.throws(() => assertServiceCheckoutCreationCapability({ ...identity, ...patch }, capability, now), /service_booking_capability_invalid/);
  });
  await t.test("an invalid clock or absent origin is not a current authorization", () => {
    assert.throws(() => assertServiceCheckoutCreationCapability(identity, capability, new Date(NaN)), /service_booking_capability_invalid/);
    assert.throws(() => assertServiceCheckoutCreationCapability(identity, { ...capability, allowedOrigin: "" }, now), /service_booking_capability_invalid/);
  });
  await t.test("the fixed complete commercial cart cannot change during asynchronous Start preparation", () => {
    const cart = { currency: "BRL" as const, total: 100, items: [{ sku: "A", name: "First", quantity: 1, price: 50 },
      { sku: "B", name: "Second", quantity: 1, price: 50 }] };
    const expected = { ...capability, cartFingerprint: paymentCartFingerprint({ cart }) };
    assert.doesNotThrow(() => assertServiceCheckoutCreationCapability({ ...identity, cart }, expected, now));
    assert.throws(() => assertServiceCheckoutCreationCapability({ ...identity, cart: { ...cart, items: [cart.items[0]!] } }, expected, now), /service_booking_cart_changed/);
    assert.throws(() => assertServiceCheckoutCreationCapability({ ...identity, cart: { ...cart, currentDiscount: 5 } }, expected, now), /service_booking_cart_changed/);
  });
});
