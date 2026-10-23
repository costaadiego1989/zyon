import assert from "node:assert/strict";
import test from "node:test";
import { CheckoutCartAuthorityService } from "../application/services/checkout-cart-authority.service.js";

function fixture(code: unknown = "SAVE10") {
  const stored = { merchantId: "merchant", sessionId: "cart", expiresAt: new Date(Date.now() + 3600000), couponCode: code, discount: 1000,
    items: [{ variantId: "variant", productId: "product", sku: "SKU", name: "Synthetic", quantity: 1, unitPriceCents: 10000 }] };
  const variant = { id: "variant", productId: "product", sku: "SKU", attributes: {}, media: [], stock: [{ quantity: 10, reserved: 0 }],
    product: { merchantId: "merchant", name: "Synthetic", type: "physical", metadata: {} }, price: { currency: "BRL", basePriceInCents: 10000, costInCents: null } };
  const authority = new CheckoutCartAuthorityService({ storefrontCart: { findUnique: async () => stored }, productVariant: { findMany: async () => [variant] } } as never,
    { execute: async () => { throw new Error("unexpected_commerce"); } } as never,
    { resolveCartPromos: async (cart: unknown) => structuredClone(cart) } as never);
  return { stored, authority };
}

test("authenticated storefront quote preserves coupon provenance instead of treating its discount as progressive", async () => {
  const f = fixture(); const cart = await f.authority.resolveStorefront("merchant", "cart");
  assert.equal(cart.currentDiscount, 10); assert.equal(cart.total, 100);
  assert.equal(cart.commercialNudge?.kind, "coupon"); assert.equal(cart.commercialNudge?.couponCode, "SAVE10");
  assert.equal(cart.appliedBenefits?.find(b => b.kind === "discount")?.amount, 10);
  assert.equal(Object.hasOwn(cart, "_storefrontCouponBinding"), false);
});

test("storefront non-coupon discount is not mislabeled as a coupon", async () => {
  const f = fixture(null); const cart = await f.authority.resolveStorefront("merchant", "cart");
  assert.equal(cart.currentDiscount, 10); assert.equal(cart.commercialNudge, undefined);
});

test("authenticated recovery of the same source lines preserves a newly reapplied canonical coupon", async () => {
  const f = fixture(); const current = await f.authority.resolveStorefront("merchant", "cart");
  const released = { ...current, currentDiscount: 0, commercialNudge: undefined, appliedBenefits: [] };
  const recovered = await f.authority.resolveRecoveredStorefront("merchant", released, "cart");
  assert.equal(recovered.currentDiscount, 10); assert.equal(recovered.commercialNudge?.couponCode, "SAVE10");
});

test("recovery with different source quantities requires review instead of silently erasing a proved coupon", async () => {
  const f = fixture(); const original = await f.authority.resolveStorefront("merchant", "cart");
  f.stored.items[0].quantity = 2;
  const before = structuredClone(f.stored);
  await assert.rejects(f.authority.resolveRecoveredStorefront("merchant", original, "cart"), (error: { getStatus(): number; getResponse(): { code: string } }) => {
    assert.equal(error.getStatus(), 409); assert.equal(error.getResponse().code, "checkout_review_required"); return true;
  }); assert.deepEqual(f.stored, before); assert.equal(original.currentDiscount, 10); assert.equal(original.items[0].quantity, 1);
});

for (const code of ["", " ", " SAVE10", "x".repeat(192)]) test("invalid persisted coupon provenance fails closed: " + JSON.stringify(code), async () => {
  await assert.rejects(fixture(code).authority.resolveStorefront("merchant", "cart"), /checkout_coupon_review_required/);
});
