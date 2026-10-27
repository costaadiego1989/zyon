import test from "node:test";
import assert from "node:assert/strict";
import { assertBoundCouponReleasePaymentsResolved } from "./bound-coupon-release-proof.js";
import type { CheckoutCouponBinding } from "./checkout-coupon-binding.js";

const binding: CheckoutCouponBinding = { version: 1, bindingId: "11111111-1111-4111-8111-111111111111",
  merchantId: "store", checkoutSessionId: "checkout", cartId: "cart", buyerId: "buyer", reservationBuyerId: null,
  couponId: "coupon", redemptionId: "redemption", discountCents: 1000, basisHash: "a".repeat(64), state: "active" };
const { state: _state, ...authority } = binding;
const cancelled = () => ({ id: "payment", merchantId: "store", sessionId: "checkout", method: "pix", currency: "BRL", amountCents: 10000,
  status: "cancelled", providerPaymentId: "provider-payment", approvedAmountCents: null,
  creation: { state: "complete", couponAuthority: authority,
    input: { intentId: "payment", merchantId: "store", sessionId: "checkout", method: "pix", currency: "BRL", amountCents: 10000 },
    cancellation: { operationId: "operation", idempotencyKey: "key", buyerId: "buyer", providerPaymentId: "provider-payment",
      startedAt: "2026-10-19T12:00:00.000Z", mutationAttemptedAt: "2026-10-19T12:00:01.000Z", state: "cancelled" } } });
test("exact cancelled generation is releasable only with complete matching cancellation journal", () => {
  assert.doesNotThrow(() => assertBoundCouponReleasePaymentsResolved(binding, [cancelled()]));
});
test("definitive allowlisted creation rejection without provider id does not require cancellation", () => {
  const payment = cancelled();
  const failed = { ...payment, status: "failed", providerPaymentId: null,
    creation: { ...payment.creation, reason: "mercadopago_pix_key_required", cancellation: undefined } };
  assert.doesNotThrow(() => assertBoundCouponReleasePaymentsResolved(binding, [failed]));
});
test("provider read already confirming cancellation needs no invented remote mutation", () => {
  const payment = cancelled(); Reflect.deleteProperty(payment.creation.cancellation, "mutationAttemptedAt");
  assert.doesNotThrow(() => assertBoundCouponReleasePaymentsResolved(binding, [payment]));
});
test("definitively rejected pre-coupon attempt does not imprison a later exact cancelled coupon generation", () => {
  const current = cancelled(), legacy = cancelled();
  legacy.id = "legacy-payment"; legacy.creation.input.intentId = legacy.id; legacy.status = "failed";
  Reflect.set(legacy, "providerPaymentId", null);
  Reflect.deleteProperty(legacy.creation, "couponAuthority"); Reflect.deleteProperty(legacy.creation, "cancellation");
  Reflect.set(legacy.creation, "reason", "mercadopago_pix_key_required");
  assert.doesNotThrow(() => assertBoundCouponReleasePaymentsResolved(binding, [legacy, current]));
  for (const poison of [undefined, null, {}]) {
    Reflect.set(legacy.creation, "couponAuthority", poison);
    assert.throws(() => assertBoundCouponReleasePaymentsResolved(binding, [legacy, current]), /checkout_coupon_release_unconfirmed/);
  }
});
test("legacy cancelled receipt must match the bound buyer and canonical immutable journal", () => {
  const current = cancelled(), legacy = cancelled();
  legacy.id = "legacy-payment"; legacy.creation.input.intentId = legacy.id;
  Reflect.deleteProperty(legacy.creation, "couponAuthority");
  assert.doesNotThrow(() => assertBoundCouponReleasePaymentsResolved(binding, [legacy, current]));
  legacy.creation.cancellation.buyerId = "foreign";
  assert.throws(() => assertBoundCouponReleasePaymentsResolved(binding, [legacy, current]), /checkout_coupon_release_unconfirmed/);
  legacy.creation.cancellation.buyerId = binding.buyerId;
  legacy.creation.input.amountCents++;
  assert.throws(() => assertBoundCouponReleasePaymentsResolved(binding, [legacy, current]), /checkout_coupon_release_unconfirmed/);
});
for (const condition of ["no payments", "pending", "requires_action", "approved", "refunded", "uncertain creation", "active creation lease",
  "cancelled no receipt", "uncertain cancellation", "foreign provider receipt", "foreign buyer receipt", "active cancellation lease",
  "positive approved amount", "foreign authority", "wrong journal input", "failed unknown reason", "failed with provider", "legacy no journal",
  "another unresolved payment"] as const) test(`release rejects ${condition} without inferred cancellation`, () => {
  const payment = cancelled();
  let payments: unknown[] = [payment];
  if (condition === "no payments") payments = [];
  if (["pending", "requires_action", "approved", "refunded"].includes(condition)) payment.status = condition;
  if (condition === "uncertain creation") payment.creation.state = "uncertain";
  if (condition === "active creation lease") Reflect.set(payment.creation, "leaseUntil", "2099-01-01T00:00:00.000Z");
  if (condition === "cancelled no receipt") Reflect.deleteProperty(payment.creation, "cancellation");
  if (condition === "uncertain cancellation") payment.creation.cancellation.state = "uncertain";
  if (condition === "foreign provider receipt") payment.creation.cancellation.providerPaymentId = "foreign";
  if (condition === "foreign buyer receipt") payment.creation.cancellation.buyerId = "foreign";
  if (condition === "active cancellation lease") Reflect.set(payment.creation.cancellation, "leaseToken", "still-active");
  if (condition === "positive approved amount") Reflect.set(payment, "approvedAmountCents", 10000);
  if (condition === "foreign authority") payment.creation.couponAuthority = { ...authority, bindingId: "22222222-2222-4222-8222-222222222222" };
  if (condition === "wrong journal input") payment.creation.input.amountCents++;
  if (condition === "failed unknown reason") {
    payment.status = "failed"; Reflect.set(payment, "providerPaymentId", null); Reflect.set(payment.creation, "reason", "timeout");
    Reflect.deleteProperty(payment.creation, "cancellation");
  }
  if (condition === "failed with provider") payment.status = "failed";
  if (condition === "legacy no journal") Reflect.deleteProperty(payment, "creation");
  if (condition === "another unresolved payment") payments.push({ ...cancelled(), id: "second", status: "pending" });
  assert.throws(() => assertBoundCouponReleasePaymentsResolved(binding, payments), /checkout_coupon_release_unconfirmed/);
});
