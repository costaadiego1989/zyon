import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { Cart } from "@zyon/shared-types";
import { CartPromoResolutionService } from "../application/services/cart-promo-resolution.service.js";
import { CheckoutCartAuthorityService } from "../application/services/checkout-cart-authority.service.js";
import type { ProductPromotionEntity, ProductPromotionRepositoryPort } from "../../catalog/domain/ports/product-promotion-repository.port.js";
import type { ValidateCartForPaymentUseCase } from "../../commerce/application/validate-cart-for-payment.use-case.js";
import { merchantRules } from "./checkout-test-fixtures.js";

const now = new Date("2026-10-18T00:00:00Z");
const promo = (patch: Partial<ProductPromotionEntity> = {}): ProductPromotionEntity => ({ id: "promo", merchantId: "merchant", variantId: "variant",
  isActive: true, startsAt: new Date("2020-01-01"), endsAt: new Date("2035-01-01"), createdAt: now, updatedAt: now,
  discountType: "percent", discountValue: 30, ...patch });
const cart = (): Cart => ({ currency: "BRL", source: "checkout", total: 100,
  items: [{ variantId: "variant", product_id: "product", category: "category", sku: "SKU", name: "Fixture", price: 100, cost: 20, quantity: 1 }] });
function pricing(options: { rows?: ProductPromotionEntity[]; max?: number; margin?: number; policy?: unknown; fail?: boolean } = {}) {
  let lookups = 0;
  const repo = { async findActiveBySku(merchant: string, variant: string) {
    assert.equal(merchant, "merchant"); assert.equal(variant, "variant"); lookups++;
    if (options.fail) throw new Error("synthetic_promotion_read_failure"); return options.rows ?? [promo()];
  } } as unknown as ProductPromotionRepositoryPort;
  const rules = { getRules: async () => Object.hasOwn(options, "policy") ? options.policy : merchantRules({ maxDiscountPercent: options.max ?? 20, minimumMarginPercent: options.margin ?? 0 }) };
  return { service: new CartPromoResolutionService(repo, rules as never), repo, rules, lookups: () => lookups };
}

test("checkout chooses greatest matching promotion, globally capped and projected without changing base input", async () => {
  const f = pricing({ rows: [promo({ id: "smaller", discountValue: 5 }), promo({ id: "greater", discountValue: 30 })] }), original = cart(), before = structuredClone(original);
  const result = await f.service.resolveCartPromos(original, "merchant", now);
  assert.equal(result.items[0].price, 80); assert.equal(result.total, 80);
  assert.deepEqual(result.discountBudget, { version: 1, originalSubtotalCents: 10000, promotionDiscountCents: 2000 });
  assert.deepEqual(original, before); assert.ok(result.commercialNotices?.some(notice => notice.code === "discount_limit_reached"));
});
test("existing cart discount is pinned once and promotion uses only remaining ORIGINAL global headroom", async () => {
  const f = pricing(), original = cart(); original.currentDiscount = 10;
  const result = await f.service.resolveCartPromos(original, "merchant", now);
  assert.equal(result.items[0].price, 90); assert.equal(result.currentDiscount, 10);
  assert.deepEqual(result.discountBudget, { version: 1, originalSubtotalCents: 10000, promotionDiscountCents: 1000 });
  assert.equal(result.total - result.currentDiscount!, 80);
});
test("repeated trusted projection never reapplies promotion over already-effective prices", async () => {
  const f = pricing(), once = await f.service.resolveCartPromos(cart(), "merchant", now);
  assert.deepEqual(await f.service.resolveCartPromos(once, "merchant", now), once);
  assert.equal(f.lookups(), 1);
});
test("configured zero does not default to 100 or manufacture a max-reached notice", async () => {
  const f = pricing({ max: 0 }), result = await f.service.resolveCartPromos(cart(), "merchant", now);
  assert.equal(result.total, 100); assert.equal(result.discountBudget?.promotionDiscountCents, 0);
  assert.deepEqual(result.commercialNotices?.map(notice => notice.code), ["discount_unavailable"]);
});
for (const cost of [undefined, 99]) test(`promotion obeys the ceiling independently of product cost (${cost})`, async () => {
  const f = pricing({ margin: 38 }), original = cart(); original.items[0].cost = cost;
  const result = await f.service.resolveCartPromos(original, "merchant", now);
  assert.equal(result.total, 80); assert.equal(result.items[0].price, 80);
  assert.deepEqual(result.commercialNotices?.map(notice => notice.code), ["discount_limit_reached"]);
});
test("options retain their price and capped promotion without a cost requirement", async () => {
  const f = pricing(), original = cart(); original.items[0].selected_options = [{ group_name: "G", item_name: "I", price_modifier: 10 }];
  const result = await f.service.resolveCartPromos(original, "merchant", now); assert.equal(result.total, 80);
  assert.deepEqual(result.items[0].selected_options, original.items[0].selected_options);
});
test("missing policy cannot authorize a promotional discount", async () => {
  const f = pricing(); await assert.rejects(new CartPromoResolutionService(f.repo).resolveCartPromos(cart(), "merchant", now));
});
for (const [index, policy] of [null, {}, merchantRules({ maxDiscountPercent: NaN }), merchantRules({ maxDiscountPercent: 101 }), merchantRules({ minimumMarginPercent: -1 })].entries()) {
  test(`malformed policy fails closed ${index}`, async () => {
    await assert.rejects(pricing({ policy }).service.resolveCartPromos(cart(), "merchant", now));
  });
}
test("existing above-ceiling benefit requires review, never silent revocation or an approved replacement", async () => {
  const f = pricing(), original = cart(); original.currentDiscount = 30;
  await assert.rejects(f.service.resolveCartPromos(original, "merchant", now)); assert.equal(original.currentDiscount, 30);
});
test("old discounted quote without coherent server budget requires review instead of treating effective price as base", async () => {
  const f = pricing(), original = cart(); original.items[0].originalPrice = 120;
  await assert.rejects(f.service.resolveCartPromos(original, "merchant", now));
});
test("promotion lookup failure never degrades silently to another price", async () => {
  await assert.rejects(pricing({ fail: true }).service.resolveCartPromos(cart(), "merchant", now), /synthetic_promotion_read_failure/);
});
test("coupon-linked promotion remains badge-only and grants no automatic inline benefit", async () => {
  const f = pricing({ rows: [promo({ couponId: "coupon", discountType: null, discountValue: null })] });
  const result = await f.service.resolveCartPromos(cart(), "merchant", now); assert.equal(result.total, 100);
});

function authority(options: { storedPrice?: number; storedDiscount?: number; stock?: number; rows?: ProductPromotionEntity[] } = {}) {
  const variant = { id: "variant", productId: "product", sku: "SKU", isActive: true, attributes: {},
    product: { id: "product", merchantId: "merchant", name: "Catalog", type: "physical", isActive: true, deletedAt: null, metadata: {}, categoryId: "category" },
    price: { basePriceInCents: 10000, costInCents: 2000, currency: "BRL" }, stock: [{ quantity: options.stock ?? 10, reserved: 0 }], media: [{ url: "https://fixture.invalid/image" }] };
  const queries: unknown[] = [];
  const prisma = { productVariant: { async findMany(args: unknown) { queries.push(args); return [variant]; } },
    productPromotion: { async findMany() { return options.rows ?? [promo()]; } },
    storefrontCart: { async findUnique() { return { expiresAt: new Date("2035-01-01"), discount: options.storedDiscount ?? 0,
      items: [{ variantId: "variant", productId: "product", sku: "SKU", name: "Stored", unitPriceCents: options.storedPrice ?? 10000, quantity: 1 }] }; } } };
  const f = pricing({ rows: options.rows });
  return { service: new CheckoutCartAuthorityService(prisma as unknown as PrismaClient, {} as ValidateCartForPaymentUseCase, f.service), queries };
}
test("direct checkout reconstructs stable identities/base/cost and strips client budget/originalPrice/discount", async () => {
  const f = authority(), submitted = cart(); submitted.currentDiscount = 90;
  submitted.discountBudget = { version: 1, originalSubtotalCents: 10000, promotionDiscountCents: 9000 };
  submitted.items[0].price = 1; submitted.items[0].originalPrice = 1000; submitted.items[0].product_id = "forged";
  const result = await f.service.resolve("merchant", submitted);
  assert.equal(result.total, 80); assert.equal(result.currentDiscount ?? 0, 0); assert.equal(result.items[0].product_id, "product");
  assert.deepEqual(result.discountBudget, { version: 1, originalSubtotalCents: 10000, promotionDiscountCents: 2000 });
  const lookup = f.queries[0] as { where: { product: unknown } };
  assert.deepEqual(lookup.where.product, { merchantId: "merchant", isActive: true, deletedAt: null });
});
test("normal storefront base is projected once and pinned cart discount cannot reopen the company ceiling", async () => {
  const f = authority({ storedDiscount: 1000 }), result = await f.service.resolveStorefront("merchant", "cart-ref");
  assert.equal(result.total, 90); assert.equal(result.currentDiscount, 10); assert.equal(result.discountBudget?.promotionDiscountCents, 1000);
});
test("normal storefront quote preserves an eligible saved reduction without repricing or a second promotion", async () => {
  const f = authority({ storedPrice: 9000 });
  const result = await f.service.resolveStorefront("merchant", "cart-ref");
  assert.equal(result.total, 90);
  assert.equal(result.items[0].price, 90);
  assert.equal(result.items[0].originalPrice, 100);
  assert.deepEqual(result.discountBudget, { version: 1, originalSubtotalCents: 10000, promotionDiscountCents: 1000 });
});
test("stock guard survives the unified promotion authority", async () => {
  const f = authority({ stock: 0 }); await assert.rejects(f.service.resolve("merchant", cart()), /checkout_insufficient_stock/);
});
test("explicit recovered quote shares product-level selection and combined budget rather than a second promo loop", async () => {
  const f = authority({ rows: [promo({ variantId: null, productId: "product" })] }), snapshot = cart();
  const result = await f.service.resolveRecoveredStorefront("merchant", snapshot, "cart-ref");
  assert.equal(result.total, 80); assert.equal(result.discountBudget?.promotionDiscountCents, 2000);
});

for (const currency of ["USD", "EUR"] as const) test(`${currency} base quotation remains compatible without granting BRL incentives`, async () => {
  const f = pricing(), original = cart(); original.currency = currency;
  const result = await f.service.resolveCartPromos(original, "merchant", now);
  assert.deepEqual(result, original); assert.equal(f.lookups(), 0); assert.equal(result.discountBudget, undefined);
});

for (const patch of [{ currentDiscount: 1 }, { discountBudget: { version: 1 as const, originalSubtotalCents: 10000, promotionDiscountCents: 0 } }]) {
  test(`non-BRL saved benefit/context requires review, not conversion ${Object.keys(patch)}`, async () => {
    const original = { ...cart(), currency: "USD" as const, ...patch }, f = pricing();
    await assert.rejects(f.service.resolveCartPromos(original, "merchant", now), /checkout_price_review_required/); assert.equal(f.lookups(), 0);
  });
}

function multilinePricing(maxDiscountPercent: number) {
  const repo = { async findActiveBySku(merchant: string, variant: string) {
    assert.equal(merchant, "merchant"); return [promo({ variantId: variant, discountValue: 80 })];
  } } as unknown as ProductPromotionRepositoryPort;
  return new CartPromoResolutionService(repo, { getRules: async () => merchantRules({ maxDiscountPercent, minimumMarginPercent: 0 }) });
}

test("canonical allocation agrees across input permutation and conserves a multiline quantity residual", async () => {
  const input: Cart = { currency: "BRL", total: 0.05, items: [
    { variantId: "a", product_id: "product", sku: "A", name: "A", price: 0.01, cost: 0, quantity: 2 },
    { variantId: "b", product_id: "product", sku: "B", name: "B", price: 0.01, cost: 0, quantity: 3 },
  ] };
  // At this tiny price 80% floors to zero; use explicit 1-cent fixed candidates.
  const repo = { async findActiveBySku(_merchant: string, variant: string) { return [promo({ variantId: variant, discountType: "fixed", discountValue: 1 })]; } } as unknown as ProductPromotionRepositoryPort;
  const service = new CartPromoResolutionService(repo, { getRules: async () => merchantRules({ maxDiscountPercent: 60, minimumMarginPercent: 0 }) });
  const forward = await service.resolveCartPromos(input, "merchant", now), reverse = await service.resolveCartPromos({ ...input, items: [...input.items].reverse() }, "merchant", now);
  const prices = (value: Cart) => Object.fromEntries(value.items.map(item => [item.variantId, item.price]));
  assert.deepEqual(prices(forward), { a: 0, b: 0.01 }); assert.deepEqual(prices(reverse), prices(forward));
  assert.equal(forward.total, 0.03); assert.equal(forward.discountBudget?.promotionDiscountCents, 2);
  assert.deepEqual(forward.commercialNotices?.map(notice => notice.code), ["discount_limited"]);
});

test("two scheduled service slots for one variant have distinct stable allocation identities", async () => {
  const original = cart(); original.total = 200;
  original.items = ["slot-a", "slot-b"].map(slotId => ({ ...original.items[0], productType: "service", fulfillmentSchedule: {
    slotId, startsAt: "2030-01-01T12:00:00Z", endsAt: "2030-01-01T13:00:00Z", timeZone: "UTC", durationMinutes: 60,
  } }));
  const service = multilinePricing(20), result = await service.resolveCartPromos(original, "merchant", now);
  assert.deepEqual(result.items.map(item => item.price), [60, 100]); assert.equal(result.total, 160);
  const reverse = await service.resolveCartPromos({ ...original, items: [...original.items].reverse() }, "merchant", now);
  assert.deepEqual(reverse.items.map(item => [item.fulfillmentSchedule?.slotId, item.price]), [["slot-b", 100], ["slot-a", 60]]);
});

test("option identities are canonical sorted JSON independent of caller array order", async () => {
  const original = cart(); original.total = 200;
  original.items = [{ ...original.items[0], variant: JSON.stringify(["variant", ["z", "a"]]) },
    { ...original.items[0], variant: JSON.stringify(["variant", ["b"]]) }];
  const result = await multilinePricing(20).resolveCartPromos(original, "merchant", now);
  assert.deepEqual(result.items.map(item => item.price), [60, 100]);
});

test("trusted repeated projection cannot retain a false cap notice after company policy increases", async () => {
  const f = pricing(), once = await f.service.resolveCartPromos(cart(), "merchant", now);
  const revalidated = await pricing({ max: 30 }).service.resolveCartPromos(once, "merchant", now);
  assert.equal(revalidated.total, once.total); assert.equal(revalidated.commercialNotices, undefined);
});

test("promotion authority never creates default merchant policy when readonly existing row is absent", async () => {
  const f = pricing(); let defaultReads = 0;
  const reader = { async getRules() { defaultReads++; return merchantRules({ maxDiscountPercent: 100 }); }, async getExistingRules() { return undefined; } };
  await assert.rejects(new CartPromoResolutionService(f.repo, reader).resolveCartPromos(cart(), "merchant", now), /checkout_discount_policy_unavailable/);
  assert.equal(defaultReads, 0);
});

test("promotion authority uses explicitly existing merchant policy instead of default-producing reader", async () => {
  const f = pricing(); let defaultReads = 0;
  const reader = { async getRules() { defaultReads++; throw new Error("default_reader_must_not_run"); },
    async getExistingRules() { return merchantRules({ maxDiscountPercent: 10, minimumMarginPercent: 0 }); } };
  const result = await new CartPromoResolutionService(f.repo, reader).resolveCartPromos(cart(), "merchant", now);
  assert.equal(result.total, 90); assert.equal(defaultReads, 0);
});

