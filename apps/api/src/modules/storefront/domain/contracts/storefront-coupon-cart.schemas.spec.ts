import assert from "node:assert/strict";
import test from "node:test";
import { storefrontCouponCartInputSchema, storefrontCouponCartResultSchema, storefrontCouponCartScopeSchema } from "./storefront-coupon-cart.schemas.js";
test("atomic coupon input captures scoped IDs and normalizes only coupon code, never client commercial authority", () => {
  assert.deepEqual(storefrontCouponCartScopeSchema.parse({ merchantId: "merchant", cartId: "cart" }), { merchantId: "merchant", cartId: "cart" });
  assert.deepEqual(storefrontCouponCartInputSchema.parse({ code: " coupon ", trustedBuyerGlobalUserId: "verified-buyer" }), { code: "COUPON", trustedBuyerGlobalUserId: "verified-buyer" });
  for (const extra of ["buyer_region", "cart", "discountCents", "merchantRules", "shipping", "cost"]) {
    assert.equal(storefrontCouponCartInputSchema.safeParse({ code: "COUPON", [extra]: 1 }).success, false);
  }
  for (const code of ["", "  ", "bad\0code", 1]) assert.equal(storefrontCouponCartInputSchema.safeParse({ code }).success, false);
});
const applied = () => ({ applied: true, reason: "success", couponCode: "COUPON", cartId: "cart", discountCents: 1000, discount: 10,
  total: 100, newTotal: 90, itemCount: 1, items: [{ variantId: "variant", name: "Item", quantity: 1, unitPrice: 100, lineTotal: 100 }] });
test("atomic coupon output preserves the public envelope and exact cents conservation", () => {
  assert.deepEqual(storefrontCouponCartResultSchema.parse(applied()), applied());
  assert.deepEqual(storefrontCouponCartResultSchema.parse({ applied: false, reason: "cart_empty" }), { applied: false, reason: "cart_empty" });
  for (const extra of ["cost", "claimToken", "redemption_id", "tx"]) {
    assert.equal(storefrontCouponCartResultSchema.safeParse({ ...applied(), [extra]: 1 }).success, false);
    const value = applied(); assert.equal(storefrontCouponCartResultSchema.safeParse({ ...value, items: [{ ...value.items[0], [extra]: 1 }] }).success, false);
  }
  for (const patch of [{ discountCents: 1001 }, { newTotal: 89 }, { total: 101 }, { itemCount: 2 }])
    assert.equal(storefrontCouponCartResultSchema.safeParse({ ...applied(), ...patch }).success, false);
});

