import assert from "node:assert/strict";
import test from "node:test";
import type { Cart, MerchantRules } from "@zyon/shared-types";
import type { ProductPromotionEntity, ProductPromotionRepositoryPort } from "../../catalog/domain/ports/product-promotion-repository.port.js";
import { applyProductPromoPricing } from "../../storefront/application/services/storefront-cart-promo.pricing.js";
import { toEngineCart } from "../../storefront/domain/services/cart-rules-engine.service.js";
import type { StorefrontCart, StorefrontCartItem } from "../../storefront/domain/ports/storefront-cart.port.js";
import { CartPromoResolutionService } from "../application/services/cart-promo-resolution.service.js";
import { merchantRules } from "./checkout-test-fixtures.js";

const date = new Date("2026-10-18T00:00:00Z");
const line = (patch: Partial<StorefrontCartItem> = {}): StorefrontCartItem => ({ variantId: "variant", productId: "product", categoryId: "category",
  name: "Synthetic server catalog", sku: "SKU", quantity: 1, unitPriceCents: 10000, ...patch });
const cart = (items = [line()], discount = 0, couponCode: string | null = null): StorefrontCart => ({ id: "cart", merchantId: "merchant", sessionId: "session",
  items, discount, couponCode, freeShipping: false, total: items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0), createdAt: date, updatedAt: date });
const promo = (patch: Partial<ProductPromotionEntity> = {}): ProductPromotionEntity => ({ id: "promo", merchantId: "merchant", variantId: "variant",
  discountType: "percent", discountValue: 30, isActive: true, startsAt: new Date("2020-01-01"), endsAt: new Date("2099-01-01"), createdAt: date, updatedAt: date, ...patch });
function repository(rows: ProductPromotionEntity[]): ProductPromotionRepositoryPort {
  return { async findActiveBySku(merchantId: string, variantId: string) {
    assert.equal(merchantId, "merchant"); assert.ok(variantId.length > 0);
    // Deliberately return all descriptors: both production projectors must apply
    // the same exact tenant/product/category/variant scope, not rely on this fake.
    return structuredClone(rows);
  } } as unknown as ProductPromotionRepositoryPort;
}
function checkoutInput(serverCart: StorefrontCart, costs: ReadonlyMap<string, number>): Cart {
  const translated = toEngineCart(serverCart, costs);
  translated.currentDiscount = serverCart.discount / 100; // Both coupon and pinned rule targets.
  translated.items = translated.items.map((item, index) => {
    const source = serverCart.items[index]!;
    return { ...item, variantId: source.variantId, product_id: source.productId,
      variant: JSON.stringify([source.variantId, (source.selectedOptions ?? []).map(option => option.itemId).sort()]),
      ...(source.pricingOriginalUnitPriceCents !== undefined ? { originalPrice: source.pricingOriginalUnitPriceCents / 100 } : {}),
      ...(source.selectedServiceSlot ? { fulfillmentSchedule: source.selectedServiceSlot } : {}) };
  });
  return translated;
}
const sharedView = (value: Cart) => ({ totalCents: Math.round(value.total * 100), discountCents: Math.round((value.currentDiscount ?? 0) * 100),
  promotionCents: value.discountBudget?.promotionDiscountCents ?? 0,
  originalCents: value.discountBudget?.originalSubtotalCents ?? Math.round(value.total * 100),
  prices: value.items.map(item => [item.sku, item.quantity, Math.round(item.price * 100)]),
  notices: value.commercialNotices?.map(notice => notice.code) ?? [] });

async function assertParity(serverCart: StorefrontCart, rows: ProductPromotionEntity[], rules: MerchantRules, costs = new Map([["variant", 20]])) {
  const repo = repository(rows), storefront = structuredClone(serverCart), input = checkoutInput(serverCart, costs), before = structuredClone(input);
  const checkout = await new CartPromoResolutionService(repo, { getRules: async () => rules }).resolveCartPromos(input, "merchant", date);
  await applyProductPromoPricing(repo, "merchant", storefront, { rules, costsByVariant: costs });
  const projected = checkoutInput(storefront, costs); projected.commercialNotices = storefront.commercialNotices;
  assert.deepEqual(sharedView(checkout), sharedView(projected)); assert.deepEqual(input, before);
  return { storefront, checkout };
}

for (const [name, rows, maximum] of [
  ["percent", [promo()], 20],
  ["fixed cents", [promo({ discountType: "fixed", discountValue: 1000 })], 20],
  ["explicit promotional price", [promo({ discountType: null, discountValue: null, promoPriceInCents: 7500 })], 30],
  ["configured zero", [promo()], 0],
  ["coupon badge only", [promo({ couponId: "coupon", discountType: null, discountValue: null })], 20],
  ["greatest matching scope", [promo({ id: "small", discountValue: 5 }), promo({ id: "product", variantId: null, productId: "product", discountValue: 25 }),
    promo({ id: "category", variantId: null, categoryId: "category", discountValue: 40 }), promo({ id: "foreign", merchantId: "foreign", discountValue: 90 })], 30],
] as const) test(`storefront and checkout project identical authoritative ${name}`, async () => {
  await assertParity(cart(), [...rows], merchantRules({ maxDiscountPercent: maximum, minimumMarginPercent: 0 }));
});

test("storefront/checkout percent floors savings at 101 cents and never rounds a 51-cent grant", async () => {
  const result = await assertParity(cart([line({ unitPriceCents: 101 })]), [promo({ discountValue: 50 })],
    merchantRules({ maxDiscountPercent: 100, minimumMarginPercent: 0 }), new Map([["variant", 0]]));
  assert.equal(result.checkout.items[0].price, 0.51); assert.equal(result.checkout.discountBudget?.promotionDiscountCents, 50);
});

test("canonical multiline allocation preserves identical quantity residual under either line order", async () => {
  const items = [line({ variantId: "a", sku: "A", unitPriceCents: 1, quantity: 2 }), line({ variantId: "b", sku: "B", unitPriceCents: 1, quantity: 3 })];
  const rows = [promo({ variantId: null, productId: "product", discountType: "fixed", discountValue: 1 })], rules = merchantRules({ maxDiscountPercent: 60, minimumMarginPercent: 0 });
  for (const ordered of [items, [...items].reverse()]) {
    const result = await assertParity(cart(ordered), rows, rules, new Map([["a", 0], ["b", 0]]));
    assert.equal(result.checkout.discountBudget?.promotionDiscountCents, 2); assert.equal(result.checkout.total, 0.03);
  }
});

for (const code of ["PINNED", null]) test(`existing ${code ? "coupon" : "rule"} target consumes global headroom once on both surfaces`, async () => {
  const result = await assertParity(cart([line()], 500, code), [promo()], merchantRules({ maxDiscountPercent: 20, minimumMarginPercent: 0 }));
  assert.equal(result.checkout.total, 85); assert.equal(result.checkout.currentDiscount, 5); assert.equal(result.checkout.discountBudget?.promotionDiscountCents, 1500);
});

for (const costs of [new Map<string, number>(), new Map([["variant", 99]])]) test(`cost cannot alter promotion parity or shared ceiling (${costs.size})`, async () => {
  const result = await assertParity(cart(), [promo()], merchantRules({ maxDiscountPercent: 20, minimumMarginPercent: 38 }), costs);
  assert.equal(result.checkout.total, 80); assert.equal(result.checkout.discountBudget?.promotionDiscountCents, 2000);
});

test("two scheduled slots share the canonical allocator but retain distinct line identities", async () => {
  const items = ["a", "b"].map(slotId => line({ selectedServiceSlot: { slotId, date: "2030-01-01", startTime: "12:00", startsAt: "2030-01-01T12:00:00Z",
    endsAt: "2030-01-01T13:00:00Z", timeZone: "UTC", durationMinutes: 60 } }));
  const result = await assertParity(cart(items), [promo({ discountValue: 80 })], merchantRules({ maxDiscountPercent: 20, minimumMarginPercent: 0 }));
  assert.deepEqual(result.checkout.items.map(item => item.price), [60, 100]);
});

test("repeat projected reads do not compound an already-effective promotion", async () => {
  const rules = merchantRules({ maxDiscountPercent: 20, minimumMarginPercent: 0 }), costs = new Map([["variant", 20]]), repo = repository([promo()]);
  const result = await assertParity(cart(), [promo()], rules, costs), first = sharedView(result.checkout);
  await applyProductPromoPricing(repo, "merchant", result.storefront, { rules, costsByVariant: costs });
  const checkout = await new CartPromoResolutionService(repo, { getRules: async () => rules }).resolveCartPromos(result.checkout, "merchant", date);
  assert.deepEqual(sharedView(checkout), first); assert.equal(result.storefront.total, 8000);
});

test("a projected promotion remains identical when optional cost becomes unavailable", async () => {
  const rules = merchantRules({ maxDiscountPercent: 20, minimumMarginPercent: 38 }), repo = repository([promo()]);
  const result = await assertParity(cart(), [promo()], rules), missingCosts = new Map<string, number>();
  const before = sharedView(result.checkout);
  const checkout = await new CartPromoResolutionService(repo, { getRules: async () => rules }).resolveCartPromos(checkoutInput(result.storefront, missingCosts), "merchant", date);
  await applyProductPromoPricing(repo, "merchant", result.storefront, { rules, costsByVariant: missingCosts });
  const storefront = checkoutInput(result.storefront, missingCosts); storefront.commercialNotices = result.storefront.commercialNotices;
  assert.deepEqual(sharedView(checkout), before); assert.deepEqual(sharedView(storefront), before);
});

test("higher company ceiling cannot silently regrant a larger promotion on the existing quote", async () => {
  const rules = merchantRules({ maxDiscountPercent: 20, minimumMarginPercent: 0 }), repo = repository([promo()]), costs = new Map([["variant", 20]]);
  const result = await assertParity(cart(), [promo()], rules, costs), higher = merchantRules({ maxDiscountPercent: 30, minimumMarginPercent: 0 });
  await applyProductPromoPricing(repo, "merchant", result.storefront, { rules: higher, costsByVariant: costs });
  const checkout = await new CartPromoResolutionService(repo, { getRules: async () => higher }).resolveCartPromos(result.checkout, "merchant", date);
  const projected = checkoutInput(result.storefront, costs); projected.commercialNotices = result.storefront.commercialNotices;
  assert.deepEqual(sharedView(projected), sharedView(checkout)); assert.equal(checkout.total, 80); assert.equal(checkout.commercialNotices, undefined);
});

test("lower company ceiling marks old over-budget quote for review without silent revocation", async () => {
  const rules = merchantRules({ maxDiscountPercent: 20, minimumMarginPercent: 0 }), repo = repository([promo()]), costs = new Map([["variant", 20]]);
  const result = await assertParity(cart(), [promo()], rules, costs), lower = merchantRules({ maxDiscountPercent: 10, minimumMarginPercent: 0 });
  await assert.rejects(new CartPromoResolutionService(repo, { getRules: async () => lower }).resolveCartPromos(result.checkout, "merchant", date));
  await assert.rejects(applyProductPromoPricing(repo, "merchant", result.storefront, { rules: lower, costsByVariant: costs }), /discount_price_review_required/);
  assert.equal(result.storefront.total, 8000); assert.equal(result.checkout.total, 80);
});

test("existing budget must reconcile with original line provenance before reuse on either surface", async () => {
  const rules = merchantRules({ maxDiscountPercent: 20, minimumMarginPercent: 0 }), repo = repository([promo()]), costs = new Map([["variant", 20]]);
  const result = await assertParity(cart(), [promo()], rules, costs);
  result.storefront.discountBudget!.originalSubtotalCents = 11000;
  result.checkout.discountBudget!.originalSubtotalCents = 11000;
  await assert.rejects(new CartPromoResolutionService(repo, { getRules: async () => rules }).resolveCartPromos(result.checkout, "merchant", date));
  await assert.rejects(applyProductPromoPricing(repo, "merchant", result.storefront, { rules, costsByVariant: costs }), /discount_price_review_required/);
});

test("existing original line provenance cannot be changed into a newly priced quote", async () => {
  const rules = merchantRules({ maxDiscountPercent: 20, minimumMarginPercent: 0 }), repo = repository([promo()]), costs = new Map([["variant", 20]]);
  const result = await assertParity(cart(), [promo()], rules, costs);
  result.storefront.items[0].pricingOriginalUnitPriceCents = 12000;
  result.checkout.items[0].originalPrice = 120;
  await assert.rejects(new CartPromoResolutionService(repo, { getRules: async () => rules }).resolveCartPromos(result.checkout, "merchant", date));
  await assert.rejects(applyProductPromoPricing(repo, "merchant", result.storefront, { rules, costsByVariant: costs }), /discount_price_review_required/);
});

