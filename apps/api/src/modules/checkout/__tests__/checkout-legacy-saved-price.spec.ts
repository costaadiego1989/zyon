import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import type { Cart } from "@zyon/shared-types";
import { CheckoutCartAuthorityService } from "../application/services/checkout-cart-authority.service.js";
import { CartPromoResolutionService } from "../application/services/cart-promo-resolution.service.js";
import { merchantRules } from "./checkout-test-fixtures.js";

function fixture({ saved = 9000, base = 10000, discount = 0, options = false } = {}) {
  const selected = options ? [{ groupId: "size", groupName: "Tamanho", itemId: "large", itemName: "Grande", priceModifierInCents: 2500 }] : [];
  const source = { merchantId: "merchant", sessionId: "cart", expiresAt: new Date("2035-01-01"), discount, couponCode: null,
    items: [{ variantId: "variant", productId: "product", sku: "SKU", name: "Saved", unitPriceCents: saved, quantity: 1, selectedOptions: selected }] };
  const variant = { id: "variant", productId: "product", sku: "SKU", attributes: {}, product: { id: "product", merchantId: "merchant", name: "Catalog", type: "physical", categoryId: null,
    metadata: options ? { optionGroups: [{ id: "size", name: "Tamanho", required: true, selectionType: "single", items: [{ id: "large", name: "Grande", priceModifierInCents: 2500 }] }] } : {} },
    price: { basePriceInCents: base, currency: "BRL", costInCents: null }, stock: [{ quantity: 100, reserved: 0 }], media: [{ url: "https://fixture.invalid/image" }] };
  const prisma = { storefrontCart: { findUnique: async () => source }, productVariant: { findMany: async () => [variant] } };
  let promotionReads = 0;
  const pricing = new CartPromoResolutionService({ findActiveBySku: async () => { promotionReads++; throw Error("must_not_apply_second_promotion"); } } as never,
    { getRules: async () => merchantRules({ maxDiscountPercent: 20, minimumMarginPercent: 99 }) });
  return { source, variant, prisma, promotionReads: () => promotionReads, service: new CheckoutCartAuthorityService(prisma as unknown as PrismaClient, {} as never, pricing) };
}
test("scoped legacy reduced saved quote survives checkout without inventing a promotion or applying P twice", async () => {
  const f = fixture(), before = structuredClone(f.source), cart = await f.service.resolveStorefront("merchant", "cart");
  assert.equal(cart.items[0]!.price, 90); assert.equal(cart.items[0]!.originalPrice, 100); assert.equal(cart.total, 90);
  assert.deepEqual(cart.discountBudget, { version: 1, originalSubtotalCents: 10000, promotionDiscountCents: 1000 });
  assert.equal(cart.items[0]!.crossSellIntent, undefined); assert.equal(f.promotionReads(), 0); assert.deepEqual(f.source, before);
});
test("paid options and existing D share exact whole-cent company ceiling without a cost requirement", async () => {
  const f = fixture({ saved: 11250, discount: 1250, options: true }), cart = await f.service.resolveStorefront("merchant", "cart");
  assert.equal(cart.items[0]!.price, 112.5); assert.equal(cart.items[0]!.originalPrice, 125); assert.equal(cart.currentDiscount, 12.5);
  assert.equal(cart.total - cart.currentDiscount!, 100); assert.equal(cart.commercialNotices?.[0]?.code, "discount_limit_reached");
});
test("over-cap source is untouched and returns a visible409 review rather than silently changing money", async () => {
  const f = fixture({ saved: 11250, discount: 1251, options: true }), before = structuredClone(f.source);
  await assert.rejects(f.service.resolveStorefront("merchant", "cart"), (error: { getStatus(): number; getResponse(): { code: string; message: string } }) => {
    assert.equal(error.getStatus(), 409); assert.equal(error.getResponse().code, "checkout_review_required");
    assert.match(error.getResponse().message, /Nenhum valor foi alterado/); return true;
  }); assert.deepEqual(f.source, before);
});
test("saved price above current catalog requires review, not silent charge or repricing", async () => {
  await assert.rejects(fixture({ saved: 10001 }).service.resolveStorefront("merchant", "cart"));
});
test("exact authenticated recovery preserves saved units and price; changed quantity cannot donate its old concession", async () => {
  const f = fixture({ discount: 500 }), snapshot = await f.service.resolveStorefront("merchant", "cart");
  const recovered = await f.service.resolveRecoveredStorefront("merchant", snapshot, "cart");
  assert.equal(recovered.total, 90); assert.equal(recovered.currentDiscount, 5);
  assert.deepEqual(recovered.discountBudget, { version: 1, originalSubtotalCents: 10000, promotionDiscountCents: 1000 });
  f.source.items[0]!.quantity = 2;
  await assert.rejects(f.service.resolveRecoveredStorefront("merchant", snapshot, "cart"));
});

test("exact-source recovery revalidates the current ceiling without silently changing an over-cap saved benefit", async () => {
  const f = fixture({ discount: 500 }), snapshot = await f.service.resolveStorefront("merchant", "cart");
  f.source.discount = 1001; const before = structuredClone(f.source);
  await assert.rejects(f.service.resolveRecoveredStorefront("merchant", snapshot, "cart"), (error: { getStatus(): number; getResponse(): { code: string } }) => {
    assert.equal(error.getStatus(), 409); assert.equal(error.getResponse().code, "checkout_review_required"); return true;
  }); assert.deepEqual(f.source, before); assert.equal(snapshot.currentDiscount, 5);
});
test("a submitted checkout cart cannot donate a forged historical price or original-budget projection", async () => {
  const f = fixture(), submitted: Cart = { currency: "BRL", total: 0.01, source: "storefront", cart_ref: "cart", discountBudget: { version: 1, originalSubtotalCents: 10000, promotionDiscountCents: 9999 },
    items: [{ sku: "SKU", variantId: "variant", product_id: "product", name: "Forged", price: 0.01, originalPrice: 100, quantity: 1 }] };
  // Direct body resolution uses canonical catalog and cannot enter saved-source
  // preservation. This fixture's promotion reader deliberately refuses.
  await assert.rejects(f.service.resolve("merchant", submitted), /must_not_apply_second_promotion/);
});

function mixedFixture(discount = 0) {
  const f = fixture({ discount }), other = { ...structuredClone(f.variant), id: "other", productId: "other-product", sku: "OTHER",
    product: { ...structuredClone(f.variant.product), id: "other-product" }, price: { ...f.variant.price, basePriceInCents: 5000 } };
  f.source.items.push({ variantId: "other", productId: "other-product", sku: "OTHER", name: "Canonical", unitPriceCents: 5000, quantity: 1, selectedOptions: [] });
  const reads: string[] = [];
  const pricing = new CartPromoResolutionService({ findActiveBySku: async (_merchant: string, variantId: string) => {
    reads.push(variantId); assert.equal(variantId, "other", "saved concession must not receive P2");
    return [{ id: "other-promo", merchantId: "merchant", variantId: "other", isActive: true, discountType: "percent", discountValue: 10,
      startsAt: new Date("2020-01-01"), endsAt: new Date("2035-01-01"), createdAt: new Date(0), updatedAt: new Date(0) }];
  } } as never, { getRules: async () => merchantRules({ maxDiscountPercent: 20 }) });
  const prisma = { ...f.prisma, productVariant: { findMany: async () => [f.variant, other] } };
  return { source: f.source, reads, pricing, service: new CheckoutCartAuthorityService(prisma as unknown as PrismaClient, {} as never, pricing) };
}

test("mixed storefront checkout keeps legacy savings and the canonical other line's automatic promotion", async () => {
  const f = mixedFixture(), before = structuredClone(f.source), result = await f.service.resolveStorefront("merchant", "cart");
  assert.equal(result.total, 135); assert.deepEqual(result.items.map(item => item.price), [90, 45]);
  assert.deepEqual(result.discountBudget, { version: 1, originalSubtotalCents: 15000, promotionDiscountCents: 1500 });
  assert.deepEqual(f.reads, ["other"]); assert.deepEqual(f.source, before);
  assert.deepEqual(await f.pricing.resolveCartPromos(result, "merchant"), result); assert.deepEqual(f.reads, ["other"]);
});

test("mixed storefront checkout preserves D and cannot reopen the global ceiling", async () => {
  const f = mixedFixture(1000), result = await f.service.resolveStorefront("merchant", "cart");
  assert.equal(result.total, 135); assert.equal(result.currentDiscount, 10); assert.equal(result.total - result.currentDiscount!, 125);
  assert.deepEqual(result.discountBudget, { version: 1, originalSubtotalCents: 15000, promotionDiscountCents: 1500 });
});

test("trusted mixed checkout projection uses stable option identity and one-cent headroom without extending P0", async () => {
  for (const reverse of [false, true]) {
    const f = mixedFixture();
    const cart: Cart = { currency: "BRL", source: "storefront", cart_ref: "cart", total: 193, currentDiscount: 30.59,
      discountBudget: { version: 1, originalSubtotalCents: 20300, promotionDiscountCents: 1000 },
      items: [{ sku: "SKU", variantId: "variant", product_id: "product", name: "Saved", price: 90, originalPrice: 100, quantity: 1 },
        ...["small", "large"].map((id, index) => ({ sku: "OTHER", variantId: "other", product_id: "other-product", name: "Canonical option",
          price: 51 + index, originalPrice: 51 + index, quantity: 1, variant: JSON.stringify(["other", [id]]),
          selected_options: [{ group_name: "Size", item_name: id, price_modifier: 1 + index }] }))] };
    if (reverse) cart.items.reverse();
    const before = structuredClone(cart), result = await f.pricing.resolveCartPromos(cart, "merchant");
    assert.equal(result.total, 192.99); assert.equal(Math.round((result.total - result.currentDiscount!) * 100), 16240);
    assert.deepEqual(result.discountBudget, { version: 1, originalSubtotalCents: 20300, promotionDiscountCents: 1001 });
    assert.equal(result.items.find(line => line.selected_options?.[0]?.item_name === "large")!.price, 51.99);
    assert.equal(result.items.find(line => line.selected_options?.[0]?.item_name === "small")!.price, 51);
    assert.deepEqual(result.commercialNotices?.map(notice => notice.code), ["discount_limit_reached"]);
    assert.deepEqual(await f.pricing.resolveCartPromos(result, "merchant"), result); assert.deepEqual(cart, before);
  }
});

test("mixed checkout promotion failure is not hidden as a successful higher-price fallback", async () => {
  const f = mixedFixture(), quoted = await f.service.resolveStorefront("merchant", "cart");
  const input: Cart = { ...quoted, total: 140, items: quoted.items.map(item => item.variantId === "other" ? { ...item, price: 50, originalPrice: 50 } : item),
    discountBudget: { version: 1, originalSubtotalCents: 15000, promotionDiscountCents: 1000 } };
  const before = structuredClone(input), pricing = new CartPromoResolutionService({ findActiveBySku: async () => { throw Error("synthetic_promo_read_failure"); } } as never,
    { getRules: async () => merchantRules({ maxDiscountPercent: 20 }) });
  await assert.rejects(pricing.resolveCartPromos(input, "merchant"), /synthetic_promo_read_failure/); assert.deepEqual(input, before);
});
