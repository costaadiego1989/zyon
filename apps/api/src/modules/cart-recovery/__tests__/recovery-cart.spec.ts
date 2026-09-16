import test from "node:test";
import assert from "node:assert/strict";
import { CheckoutCartAuthorityService } from "../../checkout/application/services/checkout-cart-authority.service.js";
import type { Cart } from "@zyon/shared-types";

function fixture() {
  const variant = { id: "variant", productId: "product", sku: "sku", product: { merchantId: "merchant", name: "Sanduiche", type: "physical",
    metadata: { optionGroups: [{ id: "extras", name: "Extras", selectionType: "multiple", items: [{ id: "cheese", name: "Queijo", priceModifierInCents: 500 }] }] } },
    price: { currency: "BRL", basePriceInCents: 2000, costInCents: 1000 }, stock: [{ quantity: 10, reserved: 0 }] };
  const promotions = [{ variantId: "variant", discountType: "percent", discountValue: 10, isActive: true }];
  const authority = new CheckoutCartAuthorityService({
    storefrontCart: { findUnique: async () => { throw new Error("recovery_must_use_checkout_snapshot"); } },
    productVariant: { findMany: async ({ where }: any) => { assert.equal(where.product.merchantId, "merchant"); return [variant]; } },
    productPromotion: { findMany: async () => promotions },
  } as never, {} as never, { resolveCartPromos: async () => { throw new Error("promotion_must_not_apply_twice"); } } as never);
  const snapshot: Cart = { source: "storefront", currency: "BRL", total: 3, currentDiscount: 2,
    items: [{ sku: "sku", variantId: "variant", product_id: "product", variant: JSON.stringify(["variant", ["cheese"]]),
      name: "Old name", quantity: 3, price: 1, selected_options: [{ group_name: "Extras", item_name: "Queijo", price_modifier: 1 }] }] };
  return { authority, variant, promotions, snapshot };
}
test("recovery keeps checkout quantities after temporary cart eviction and applies current prices once", async () => {
  const h = fixture();
  const cart = await h.authority.resolveRecoveredStorefront("merchant", h.snapshot, "evicted-cart");
  assert.equal(cart.items[0]?.quantity, 3);
  assert.equal(cart.items[0]?.price, 23);
  assert.equal(cart.total, 69);
  assert.equal(cart.currentDiscount, 0);
  assert.equal(cart.items[0]?.selected_options?.[0]?.price_modifier, 5);
  assert.equal(cart.items[0]?.name, "Sanduiche");
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
