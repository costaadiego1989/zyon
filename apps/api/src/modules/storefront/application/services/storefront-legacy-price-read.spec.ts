import test from "node:test";
import assert from "node:assert/strict";
import type { StorefrontCart } from "../../domain/ports/storefront-cart.port.js";
import { loadCartCosts, reevaluateCartRules } from "./reevaluate-cart-rules.js";
import { merchantRules } from "../../../checkout/__tests__/checkout-test-fixtures.js";
import { applyProductPromoPricing } from "./storefront-cart-promo.pricing.js";

function fixture(saved = 9000, discount = 500) {
  const source: StorefrontCart = { id: "row", merchantId: "merchant", sessionId: "cart", couponCode: null,
    discount, freeShipping: false, total: saved, createdAt: new Date(0), updatedAt: new Date(0),
    items: [{ variantId: "variant", productId: "product", sku: "SKU", name: "Saved", quantity: 1, unitPriceCents: saved }] };
  const prisma = { productPrice: { findMany: async () => [{ variantId: "variant", costInCents: null, basePriceInCents: 10000,
    variant: { productId: "product", sku: "SKU", product: { categoryId: null, metadata: {} } } }] }, checkoutSetting: { findUnique: async () => ({ advancedRules: [] }) } };
  let writes = 0, promotions = 0;
  const deps = { prisma, merchantRepo: { getRules: async () => merchantRules({ maxDiscountPercent: 20 }) },
    cartRepo: { applyRuleOutcome: async () => { writes++; throw Error("legacy_read_must_not_write"); } },
    productPromotionRepo: { findActiveBySku: async () => { promotions++; throw Error("legacy_read_must_not_apply_second_P"); } } };
  return { source, prisma, deps, writes: () => writes, promotions: () => promotions };
}
test("canonical lookup retains saved S and separately reconstructs B without inventing cost", async () => {
  const f = fixture(), projection = structuredClone(f.source), costs = await loadCartCosts(f.prisma as never, "merchant", projection, true);
  assert.equal(projection.items[0]!.unitPriceCents, 9000); assert.equal(projection.items[0]!.pricingOriginalUnitPriceCents, 10000);
  assert.deepEqual(projection.discountBudget, { version: 1, originalSubtotalCents: 10000, promotionDiscountCents: 1000 });
  assert.equal(costs.size, 0); assert.equal(f.source.discountBudget, undefined);
});
test("legacy GET projection preserves S and D, does not apply P twice or write source", async () => {
  const f = fixture(), before = structuredClone(f.source), result = await reevaluateCartRules(f.deps as never, "merchant", "cart", f.source);
  assert.equal(result.cart.total, 9000); assert.equal(result.cart.discount, 500); assert.equal(result.cart.items[0]!.unitPriceCents, 9000);
  assert.equal(f.writes(), 0); assert.equal(f.promotions(), 0); assert.deepEqual(f.source, before);
});
test("above-cap GET still displays exact saved items and a visible warning, without authorizing checkout or writing", async () => {
  const f = fixture(7900, 0), before = structuredClone(f.source), result = await reevaluateCartRules(f.deps as never, "merchant", "cart", f.source);
  assert.equal(result.cart.total, 7900); assert.equal(result.cart.items[0]!.unitPriceCents, 7900);
  assert.match(result.cart.commercialNotices![0]!.message, /Nenhum valor foi alterado/);
  assert.equal(f.writes(), 0); assert.deepEqual(f.source, before);
});

function mixedFixture(discount = 0) {
  const f = fixture(9000, discount);
  f.source.items.push({ variantId: "other", productId: "other-product", sku: "OTHER", name: "Canonical", quantity: 1, unitPriceCents: 5000 });
  f.source.total = 14000;
  const reads: string[] = [];
  const deps = { ...f.deps, prisma: { ...f.prisma, productPrice: { findMany: async () => [
    { variantId: "variant", costInCents: null, basePriceInCents: 10000, variant: { productId: "product", sku: "SKU", product: { categoryId: null, metadata: {} } } },
    { variantId: "other", costInCents: null, basePriceInCents: 5000, variant: { productId: "other-product", sku: "OTHER", product: { categoryId: null, metadata: {} } } },
  ] } }, productPromotionRepo: { findActiveBySku: async (_merchant: string, variantId: string) => {
    reads.push(variantId); assert.equal(variantId, "other", "saved concession must not receive P2");
    return [{ id: "other-promo", merchantId: "merchant", variantId: "other", isActive: true, discountType: "percent", discountValue: 10,
      startsAt: new Date("2020-01-01"), endsAt: new Date("2035-01-01"), createdAt: new Date(0), updatedAt: new Date(0) }];
  } } };
  return { ...f, deps, reads };
}

test("mixed GET preserves saved P0 and applies the other line's current promotion without source/reservation writes", async () => {
  const f = mixedFixture(), before = structuredClone(f.source), result = await reevaluateCartRules(f.deps as never, "merchant", "cart", f.source);
  assert.equal(result.cart.total, 13500); assert.deepEqual(result.cart.items.map(item => item.unitPriceCents), [9000, 4500]);
  assert.deepEqual(result.cart.discountBudget, { version: 1, originalSubtotalCents: 15000, promotionDiscountCents: 1500 });
  assert.deepEqual(f.reads, ["other"]); assert.equal(f.writes(), 0); assert.deepEqual(f.source, before);
});

test("mixed GET allocates only headroom after saved P0 plus D and emits one ceiling notice", async () => {
  const f = mixedFixture(1750), before = structuredClone(f.source), result = await reevaluateCartRules(f.deps as never, "merchant", "cart", f.source);
  assert.equal(result.cart.total, 13750); assert.equal(result.cart.discount, 1750); assert.equal(result.cart.total - result.cart.discount, 12000);
  assert.deepEqual(result.cart.items.map(item => item.unitPriceCents), [9000, 4750]);
  assert.deepEqual(result.cart.discountBudget, { version: 1, originalSubtotalCents: 15000, promotionDiscountCents: 1250 });
  assert.deepEqual(result.cart.commercialNotices?.map(notice => notice.code), ["discount_limit_reached"]);
  assert.equal(f.writes(), 0); assert.deepEqual(f.source, before);
});

test("trusted mixed read projection allocates one cent deterministically across option identities and never reapplies P", async () => {
  for (const reverse of [false, true]) {
    const f = mixedFixture(3059), source = structuredClone(f.source);
    source.items = [{ ...source.items[0]!, pricingOriginalUnitPriceCents: 10000 }, ...["small", "large"].map((id, index) => ({
      ...source.items[1]!, unitPriceCents: 5100 + index * 100, pricingOriginalUnitPriceCents: 5100 + index * 100,
      selectedOptions: [{ groupId: "size", groupName: "Size", itemId: id, itemName: id, priceModifierInCents: 100 + index * 100 }],
    }))];
    if (reverse) source.items.reverse();
    source.total = 19300; source.discountBudget = { version: 1, originalSubtotalCents: 20300, promotionDiscountCents: 1000 };
    const authority = { rules: merchantRules({ maxDiscountPercent: 20 }), costsByVariant: new Map<string, number>() };
    await applyProductPromoPricing(f.deps.productPromotionRepo as never, "merchant", source, authority);
    assert.equal(source.total, 19299); assert.equal(source.total - source.discount, 16240);
    assert.deepEqual(source.discountBudget, { version: 1, originalSubtotalCents: 20300, promotionDiscountCents: 1001 });
    assert.equal(source.items.find(line => line.selectedOptions?.[0]?.itemId === "large")!.unitPriceCents, 5199);
    assert.equal(source.items.find(line => line.selectedOptions?.[0]?.itemId === "small")!.unitPriceCents, 5100);
    assert.deepEqual(source.commercialNotices?.map(notice => notice.code), ["discount_limit_reached"]);
    const once = structuredClone(source);
    await applyProductPromoPricing(f.deps.productPromotionRepo as never, "merchant", source, authority);
    assert.deepEqual(source, once); assert.equal(f.writes(), 0);
  }
});

test("mixed read projector refuses a canonical promotion read failure without partially changing the quote", async () => {
  const f = mixedFixture(), quote = structuredClone(f.source);
  await loadCartCosts(f.deps.prisma as never, "merchant", quote, true);
  const before = structuredClone(quote);
  await assert.rejects(applyProductPromoPricing({ findActiveBySku: async () => { throw Error("synthetic_promo_read_failure"); } }, "merchant", quote,
    { rules: merchantRules({ maxDiscountPercent: 20 }), costsByVariant: new Map() }), /synthetic_promo_read_failure/);
  assert.deepEqual(quote, before); assert.equal(f.writes(), 0);
});
