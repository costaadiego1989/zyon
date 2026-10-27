import test from "node:test";
import assert from "node:assert/strict";
import { CheckoutCartAuthorityService } from "../../checkout/application/services/checkout-cart-authority.service.js";
import type { Cart } from "@zyon/shared-types";
import { CartPromoResolutionService } from "../../checkout/application/services/cart-promo-resolution.service.js";
import { merchantRules } from "../../checkout/__tests__/checkout-test-fixtures.js";
import { evaluateCombinedDiscount } from "@zyon/rules-engine";
import { couponNudge } from "../../coupons/application/services/checkout-coupon.js";

function fixture(options: { baseCents?: number; extraCents?: number; quantity?: number; ceiling?: number; evictedSource?: boolean } = {}) {
  const baseCents = options.baseCents ?? 2000, extraCents = options.extraCents ?? 500;
  const variant = { id: "variant", productId: "product", sku: "sku", product: { merchantId: "merchant", name: "Sanduiche", type: "physical",
    metadata: { optionGroups: [{ id: "extras", name: "Extras", selectionType: "multiple", items: [{ id: "cheese", name: "Queijo", priceModifierInCents: extraCents }] }] } },
    price: { currency: "BRL", basePriceInCents: baseCents, costInCents: 999999 }, stock: [{ quantity: 10, reserved: 0 }], media: [{ url: "https://example.test/product.jpg" }] };
  const promotions = [{ id: "promotion", merchantId: "merchant", variantId: "variant", discountType: "percent", discountValue: 10,
    isActive: true, startsAt: new Date(0), endsAt: new Date("2100-01-01T00:00:00Z") }];
  const rules = merchantRules({ maxDiscountPercent: options.ceiling ?? 20, minimumMarginPercent: 99 });
  let promotionReads = 0, projections = 0;
  const projector = new CartPromoResolutionService({ findActiveBySku: async (merchantId: string, variantId: string) => {
    assert.equal(merchantId, "merchant"); assert.equal(variantId, "variant"); promotionReads++; return promotions;
  } } as never, {
    getExistingRules: async (merchantId: string) => { assert.equal(merchantId, "merchant"); return rules; },
    getRules: async () => { throw new Error("recovery_must_not_provision_rules"); },
  });
  const authority = new CheckoutCartAuthorityService({
    storefrontCart: { findUnique: async () => { if (options.evictedSource) return null; throw new Error("recovery_must_use_checkout_snapshot"); } },
    productVariant: { findMany: async ({ where }: any) => { assert.equal(where.product.merchantId, "merchant"); return [variant]; } },
    productPromotion: { findMany: async () => { throw new Error("recovery_must_use_shared_projection"); } },
  } as never, {} as never, { resolveCartPromos: async (value: Cart, merchantId: string) => {
    projections++; assert.equal(value.items[0]?.originalPrice, undefined); assert.equal(value.discountBudget, undefined);
    return projector.resolveCartPromos(value, merchantId);
  } } as never);
  const snapshot: Cart = { source: "storefront", currency: "BRL", total: 3, currentDiscount: 2,
    items: [{ sku: "sku", variantId: "variant", product_id: "product", variant: JSON.stringify(["variant", ["cheese"]]),
      name: "Old name", quantity: options.quantity ?? 3, price: 1, selected_options: [{ group_name: "Extras", item_name: "Queijo", price_modifier: 1 }] }] };
  return { authority, variant, promotions, snapshot, projector, rules, calls: () => ({ promotionReads, projections }) };
}
test("recovery keeps checkout quantities after temporary cart eviction and applies current prices once", async () => {
  const h = fixture();
  const cart = await h.authority.resolveRecoveredStorefront("merchant", h.snapshot, "evicted-cart");
  assert.equal(cart.items[0]?.quantity, 3);
  assert.equal(cart.items[0]?.originalPrice, 25);
  assert.equal(cart.items[0]?.price, 22.5);
  assert.equal(cart.total, 67.5);
  assert.equal(cart.currentDiscount, 0);
  assert.equal(cart.items[0]?.selected_options?.[0]?.price_modifier, 5);
  assert.equal(cart.items[0]?.name, "Sanduiche");
  assert.deepEqual(h.calls(), { promotionReads: 1, projections: 1 });
  assert.deepEqual(cart.discountBudget, { version: 1, originalSubtotalCents: 7500, promotionDiscountCents: 750 });
  assert.equal(h.snapshot.items[0]?.price, 1); // Never mutate the historical snapshot.
});

test("recovery discounts paid size and color additions together with the product", async () => {
  const h = fixture();
  h.variant.product.metadata.optionGroups[0].items = [
    { id: "size-l", name: "Tamanho L", priceModifierInCents: 700 },
    { id: "color-blue", name: "Cor azul", priceModifierInCents: 300 },
  ];
  h.snapshot.items[0]!.variant = JSON.stringify(["variant", ["size-l", "color-blue"]]);
  const cart = await h.authority.resolveRecoveredStorefront("merchant", h.snapshot, "evicted-cart");
  assert.equal(cart.items[0]?.originalPrice, 30); assert.equal(cart.items[0]?.price, 27); assert.equal(cart.total, 81);
  assert.deepEqual(cart.items[0]?.selected_options?.map(option => option.price_modifier), [7, 3]);
});

test("recovery without additions keeps the canonical promotion and quantity", async () => {
  const h = fixture(); h.snapshot.items[0]!.variant = JSON.stringify(["variant", []]); delete h.snapshot.items[0]!.selected_options;
  const cart = await h.authority.resolveRecoveredStorefront("merchant", h.snapshot, "evicted-cart");
  assert.equal(cart.items[0]?.originalPrice, 20); assert.equal(cart.items[0]?.price, 18); assert.equal(cart.total, 54);
  assert.deepEqual(cart.items[0]?.selected_options, []);
});

test("recovery rounds the unit discount in whole cents before multiplying quantity", async () => {
  const h = fixture({ baseCents: 1005, extraCents: 2 });
  const cart = await h.authority.resolveRecoveredStorefront("merchant", h.snapshot, "evicted-cart");
  assert.equal(cart.items[0]?.originalPrice, 10.07); assert.equal(cart.items[0]?.price, 9.07); assert.equal(cart.total, 27.21);
  assert.deepEqual(cart.discountBudget, { version: 1, originalSubtotalCents: 3021, promotionDiscountCents: 300 });
});

test("recovery projection replay never discounts an already promoted options price again", async () => {
  const h = fixture(), first = await h.authority.resolveRecoveredStorefront("merchant", h.snapshot, "evicted-cart");
  const replay = await h.projector.resolveCartPromos(first, "merchant");
  assert.deepEqual(replay, first); assert.deepEqual(h.calls(), { promotionReads: 1, projections: 1 });
});

test("options and quantity stay within the company ceiling, with no second stacking budget or margin gate", async () => {
  const h = fixture({ ceiling: 6 }), cart = await h.authority.resolveRecoveredStorefront("merchant", h.snapshot, "evicted-cart");
  assert.equal(cart.items[0]?.price, 23.5); assert.equal(cart.total, 70.5);
  assert.deepEqual(cart.discountBudget, { version: 1, originalSubtotalCents: 7500, promotionDiscountCents: 450 });
  assert.equal(cart.commercialNotices?.[0]?.code, "discount_limit_reached");
  const combined = evaluateCombinedDiscount(cart, h.rules, 1000);
  assert.equal(combined.kind, "authorized"); assert.equal(combined.cartDiscountCents, 0);
  assert.equal(combined.totalDiscountCents, 450); assert.equal(combined.remainingDiscountCents, 0);
});
test("recovery rejects changed options and insufficient stock", async () => {
  const h = fixture();
  h.variant.stock[0].quantity = 2;
  await assert.rejects(h.authority.resolveRecoveredStorefront("merchant", h.snapshot, "cart"), /checkout_insufficient_stock/);
  h.variant.stock[0].quantity = 10;
  h.variant.product.metadata.optionGroups[0].items = [];
  await assert.rejects(h.authority.resolveRecoveredStorefront("merchant", h.snapshot, "cart"), /checkout_product_options_changed/);
});
test("recovery rejects a malformed selection and a product outside the merchant", async () => {
  const h = fixture();
  h.snapshot.items[0]!.variant = "not-json";
  await assert.rejects(h.authority.resolveRecoveredStorefront("merchant", h.snapshot, "cart"), /checkout_product_options_changed/);
  h.snapshot.items[0]!.variant = JSON.stringify(["variant", []]);
  h.variant.product.merchantId = "another";
  await assert.rejects(h.authority.resolveRecoveredStorefront("merchant", h.snapshot, "cart"), /checkout_product_unavailable/);
});

test("unreferenced canonical recovery may refresh equal original-price metadata without treating it as saved discount proof", async () => {
  const h = fixture(), before = structuredClone(h.snapshot); h.snapshot.items[0]!.originalPrice = h.snapshot.items[0]!.price;
  const cart = await h.authority.resolveRecoveredStorefront("merchant", h.snapshot, "evicted-cart");
  assert.equal(cart.total, 67.5); assert.equal(cart.currentDiscount, 0); assert.equal(cart.items[0]!.price, 22.5);
  assert.equal(h.snapshot.items[0]!.price, before.items[0]!.price); assert.equal(h.snapshot.items[0]!.originalPrice, 1);
});

for (const proof of ["reduction", "budget", "coupon", "grant", "source_reference"] as const)
test(`recovery without an exact live source cannot silently replace saved ${proof}`, async () => {
  const h = fixture({ evictedSource: proof === "source_reference" }); h.snapshot.items[0]!.price = 25; h.snapshot.total = 75;
  if (proof === "reduction") h.snapshot.items[0]!.originalPrice = 30;
  if (proof === "budget") h.snapshot.discountBudget = { version: 1, originalSubtotalCents: 9000, promotionDiscountCents: 1500 };
  if (proof === "coupon") h.snapshot.commercialNudge = couponNudge({ code: "SAVE", discount_type: "fixed" }, 2, 0, 75);
  if (proof === "grant") h.snapshot.appliedBenefits = [{ kind: "discount", label: "Saved benefit", amount: 2 }];
  if (proof === "source_reference") h.snapshot.cart_ref = "evicted-cart";
  const before = structuredClone(h.snapshot);
  await assert.rejects(h.authority.resolveRecoveredStorefront("merchant", h.snapshot, "evicted-cart"), (error: { getStatus(): number; getResponse(): { code: string } }) => {
    assert.equal(error.getStatus(), 409); assert.equal(error.getResponse().code, "checkout_review_required"); return true;
  }); assert.deepEqual(h.snapshot, before); assert.deepEqual(h.calls(), { promotionReads: 0, projections: 0 });
});
