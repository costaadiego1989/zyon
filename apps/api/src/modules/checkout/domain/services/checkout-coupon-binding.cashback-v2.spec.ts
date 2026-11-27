import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { checkoutCouponCombinedDiscountCents, parseCheckoutCouponBinding, parseCheckoutCouponPaymentAuthority,
  planBoundCouponRedemption, assertCheckoutCouponBindingPreserved } from "./checkout-coupon-binding.js";

const identity = { version: 1 as const, bindingId: randomUUID(), merchantId: "merchant", cartId: "cart",
  checkoutSessionId: "checkout", buyerId: "buyer", reservationBuyerId: "buyer", redemptionId: "redemption", couponId: "coupon",
  discountCents: 1000, basisHash: "a".repeat(64) };

test("CS-07 V1 coupon identity retains its exact shape and refuses V2 fields", () => {
  assert.deepEqual(parseCheckoutCouponPaymentAuthority(identity), identity);
  assert.equal(checkoutCouponCombinedDiscountCents(identity), 1000);
  assert.throws(() => parseCheckoutCouponPaymentAuthority({ ...identity, combinedDiscountCents: 1500 }), /binding_conflict/);
});

test("CS-06 V2 freezes coupon 1000 separately from combined 1500 and redeems only the coupon", () => {
  const v2 = { ...identity, version: 2 as const, combinedDiscountCents: 1500, commercialBenefitsVersion: 2 };
  assert.deepEqual(parseCheckoutCouponPaymentAuthority(v2), v2);
  assert.equal(checkoutCouponCombinedDiscountCents(v2), 1500);
  const binding = parseCheckoutCouponBinding({ ...v2, state: "active" });
  const plan = planBoundCouponRedemption({ binding, orderAuthority: { ...v2, orderId: "order" },
    redemption: { id: "redemption", merchantId: "merchant", sessionId: "cart", couponId: "coupon", buyerGlobalUserId: "buyer",
      discountCents: 1000, status: "applied", orderId: null } });
  assert.equal(plan.kind, "redeem"); assert.equal(plan.discountCents, 1000); assert.equal(plan.redemptionId, "redemption");
});

test("CS-04 V2 cannot change source revision, inflate coupon redemption, downgrade or smuggle cashback", () => {
  const v2 = { ...identity, version: 2 as const, combinedDiscountCents: 1500, commercialBenefitsVersion: 2 };
  const binding = { ...v2, state: "active" as const };
  assert.throws(() => assertCheckoutCouponBindingPreserved(binding, { ...binding, commercialBenefitsVersion: 3 }), /binding_conflict/);
  assert.throws(() => assertCheckoutCouponBindingPreserved(binding, { ...identity, state: "active" }), /binding_conflict/);
  assert.throws(() => parseCheckoutCouponPaymentAuthority({ ...v2, combinedDiscountCents: 999 }), /binding_conflict/);
  assert.throws(() => parseCheckoutCouponPaymentAuthority({ ...v2, cashbackCents: 1500 }), /binding_conflict/);
  assert.throws(() => planBoundCouponRedemption({ binding, orderAuthority: { ...v2, orderId: "order" },
    redemption: { id: "redemption", merchantId: "merchant", sessionId: "cart", couponId: "coupon", buyerGlobalUserId: "buyer",
      discountCents: 1500, status: "applied", orderId: null } }), /binding_conflict/);
});
