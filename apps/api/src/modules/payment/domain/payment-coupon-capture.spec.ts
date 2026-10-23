import assert from "node:assert/strict";
import test from "node:test";
import { PaymentIntentEntity } from "./payment-intent.entity.js";
import { readPaymentCouponAuthority } from "./payment-coupon-authority.js";
import { assertSamePaymentIdentity } from "./payment-persistence.js";
import { assertNoPaymentCouponAuthorityInProviderInput } from "./payment-coupon-authority.js";

const authority = () => ({ version: 1 as const, bindingId: "11111111-1111-4111-8111-111111111111",
  merchantId: "merchant", cartId: "cart", checkoutSessionId: "checkout", buyerId: "buyer",
  reservationBuyerId: null, redemptionId: "reservation", couponId: "coupon", discountCents: 100,
  basisHash: "ab".repeat(32) });
function ready() {
  const entity = PaymentIntentEntity.create({ merchantId: "merchant", sessionId: "checkout",
    idempotencyKey: "key", amountCents: 900, currency: "BRL", method: "pix" });
  entity.prepareCreation({ merchantId: "merchant", sessionId: "checkout", intentId: entity.id,
    amountCents: 900, currency: "BRL", method: "pix" });
  return entity;
}

test("committed coupon capture acknowledges detached authority before provider claim", () => {
  const entity = ready(), source = authority();
  const before = entity.snapshot();
  entity.acknowledgeCouponCapture(source);
  source.cartId = "mutated";
  assert.equal(readPaymentCouponAuthority(entity.snapshot())?.cartId, "cart");
  assert.deepEqual(entity.snapshot().creation?.input, before.creation?.input);
  assert.equal(Object.hasOwn(entity.snapshot().creation!.input, "couponAuthority"), false);
  entity.persisted(1);
  assert.equal(entity.claimCreation("lease", new Date(0)), "create");
  assert.equal(readPaymentCouponAuthority(entity.snapshot())?.redemptionId, "reservation");
});

for (const phase of ["persisted", "claimed", "missing-creation"] as const) {
  test(`coupon capture cannot be added after ${phase}`, () => {
    const entity = phase === "missing-creation"
      ? PaymentIntentEntity.create({ merchantId: "merchant", sessionId: "checkout", idempotencyKey: "key", amountCents: 900, currency: "BRL", method: "pix" })
      : ready();
    if (phase === "persisted") entity.persisted(1);
    if (phase === "claimed") entity.claimCreation("lease", new Date(0));
    const before = entity.snapshot();
    assert.throws(() => entity.acknowledgeCouponCapture(authority()), /payment_coupon_authority_conflict/);
    assert.deepEqual(entity.snapshot(), before);
  });
}

for (const field of ["merchantId", "checkoutSessionId"] as const) {
  test(`coupon capture refuses divergent ${field} without mutating entity`, () => {
    const entity = ready(), before = entity.snapshot();
    assert.throws(() => entity.acknowledgeCouponCapture({ ...authority(), [field]: "foreign" }), /payment_coupon_authority_conflict/);
    assert.deepEqual(entity.snapshot(), before);
  });
}

test("capture is single use and existing immutable journal cannot drop authority", () => {
  const entity = ready(); entity.acknowledgeCouponCapture(authority());
  const captured = entity.snapshot();
  assert.throws(() => entity.acknowledgeCouponCapture({ ...authority(), cartId: "other" }), /payment_coupon_authority_conflict/);
  assert.deepEqual(entity.snapshot(), captured);
  const legacy = ready().snapshot();
  assert.throws(() => assertSamePaymentIdentity(captured, legacy), /payment_coupon_authority_conflict/);
});

test("private storefront admission context is forbidden in provider payload, including undefined presence", () => {
  for (const value of [undefined, null, { buyerId: "buyer" }])
    assert.throws(() => assertNoPaymentCouponAuthorityInProviderInput({ storefrontCouponScope: value }), /payment_coupon_authority_conflict/);
});
