import test from "node:test";
import assert from "node:assert/strict";
import type { MerchantRules } from "@zyon/shared-types";
import type { ProductPromotionRepositoryPort } from "../../../catalog/domain/ports/product-promotion-repository.port.js";
import type { StorefrontCart } from "../../domain/ports/storefront-cart.port.js";
import { applyProductPromoPricing } from "./storefront-cart-promo.pricing.js";

const rules = { maxDiscountPercent: 20, minimumMarginPercent: 0, allowFreeShipping: false } as MerchantRules;
const cart = (): StorefrontCart => ({ id: "cart", merchantId: "m", sessionId: "s", couponCode: null,
  discount: 0, freeShipping: false, total: 10000, createdAt: new Date(0), updatedAt: new Date(0),
  items: [{ variantId: "v", productId: "p", categoryId: "c", sku: "sku", name: "Product", quantity: 1, unitPriceCents: 10000 }] });
const promo = (id: string, percent: number) => ({ id, merchantId: "m", productId: "p", isActive: true,
  discountType: "percent", discountValue: percent, startsAt: new Date(0), endsAt: new Date("2099-01-01"),
  createdAt: new Date(0), updatedAt: new Date(0) });
const repo = (...promotions: ReturnType<typeof promo>[]) => ({ findActiveBySku: async () => promotions }) as unknown as ProductPromotionRepositoryPort;
const authority = (policy = rules) => ({ rules: policy, costsByVariant: new Map([["v", 10]]) });

test("greatest applicable promotion is capped against the original merchandise total", async () => {
  const input = cart();
  await applyProductPromoPricing(repo(promo("a", 10), promo("z", 50)), "m", input, authority());
  assert.equal(input.total, 8000);
  assert.deepEqual(input.discountBudget, { version: 1, originalSubtotalCents: 10000, promotionDiscountCents: 2000 });
  assert.equal(input.commercialNotices?.[0]?.code, "discount_limit_reached");
});

test("existing coupon consumes the same budget without being revoked or compounded", async () => {
  const input = cart(); input.couponCode = "SAVED"; input.discount = 1000;
  await applyProductPromoPricing(repo(promo("a", 50)), "m", input, authority());
  assert.equal(input.total, 9000);
  assert.equal(input.discount, 1000);
  assert.equal(10000 - input.total + input.discount, 2000);
});

test("a projected snapshot cannot be promoted twice", async () => {
  const input = cart();
  await applyProductPromoPricing(repo(promo("a", 10)), "m", input, authority());
  const once = structuredClone(input);
  await applyProductPromoPricing(repo(promo("a", 10)), "m", input, authority());
  assert.deepEqual(input, once);
});

test("a preserved historical discount does not carry a promotion identity without new savings", async () => {
  const input = cart();
  const first = await applyProductPromoPricing(repo(promo("original-offer", 10)), "m", input, authority());
  assert.equal(first.get("v")?.promotionId, "original-offer");
  const preserved = await applyProductPromoPricing(repo(), "m", input, authority());
  assert.equal(input.total, 9000);
  assert.equal(preserved.get("v")?.promotionId, undefined);
});

test("zero or absent policy cannot grant; unknown cost does not veto the ceiling", async () => {
  for (const options of [undefined, authority({ ...rules, maxDiscountPercent: 0 }), { rules, costsByVariant: new Map() }]) {
    const input = cart();
    await applyProductPromoPricing(repo(promo("a", 50)), "m", input, options);
    if (options?.rules.maxDiscountPercent === 20) {
      assert.equal(input.total, 8000);
      assert.equal(input.commercialNotices?.[0]?.code, "discount_limit_reached");
    } else {
      assert.equal(input.total, 10000);
      assert.notEqual(input.commercialNotices?.[0]?.code, "discount_limit_reached");
    }
  }
});

test("ceilings below an already granted coupon require review instead of silently repricing", async () => {
  const input = cart(); input.couponCode = "SAVED"; input.discount = 3000;
  const before = structuredClone(input);
  await assert.rejects(applyProductPromoPricing(repo(promo("a", 50)), "m", input, authority()), /discount.*review/);
  assert.deepEqual(input, before);
});

