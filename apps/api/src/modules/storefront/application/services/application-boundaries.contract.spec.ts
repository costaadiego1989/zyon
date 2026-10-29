import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import type { ProductPromotionRepositoryPort } from "../../../catalog/domain/ports/product-promotion-repository.port.js";
import type { StorefrontCart } from "../../domain/ports/storefront-cart.port.js";
import { applyProductPromoPricing } from "./storefront-cart-promo.pricing.js";
import { applyProductPromoPricing as legacyPricing } from "../../infrastructure/pricing/storefront-cart-promo.pricing.js";
import { reevaluateCartRules, type CartRulesDependencies } from "./reevaluate-cart-rules.js";
import { reevaluateCartRules as legacyRules } from "../../infrastructure/tool-handlers/cart.handlers.js";
import { loadProductNoticeRules, productRuleNotices } from "./product-rule-notices.js";
import { loadProductNoticeRules as legacyNoticeRules, productRuleNotices as legacyNotices } from "../../infrastructure/product-rule-notices.js";

function cart(): StorefrontCart {
  return { id: "cart", merchantId: "merchant-a", sessionId: "session-a", items: [{ variantId: "variant-a", productId: "product-a", sku: "sku-a", name: "Product", quantity: 2, unitPriceCents: 10000 }], couponCode: null, discount: 0, freeShipping: false, total: 20000, createdAt: new Date(0), updatedAt: new Date(0) };
}

test("legacy infrastructure entry points export the exact application functions", () => {
  assert.equal(legacyPricing, applyProductPromoPricing);
  assert.equal(legacyRules, reevaluateCartRules);
  assert.equal(legacyNoticeRules, loadProductNoticeRules);
  assert.equal(legacyNotices, productRuleNotices);
});

for (const [promotion, price, badge] of [
  [{ discountType: "percent", discountValue: 20 }, 8000, { originalPriceCents: 10000, discountPercent: 20 }],
  [{ discountType: "fixed", discountValue: 2500 }, 7500, { originalPriceCents: 10000, discountPercent: 25 }],
  [{ promoPriceInCents: 6000 }, 6000, { originalPriceCents: 10000, discountPercent: 40 }],
  [{ couponId: "coupon-a" }, 10000, { originalPriceCents: 10000, coupon: true }],
] as const) {
  test(`application pricing preserves ${JSON.stringify(promotion)} and tenant scope`, async () => {
    const input = cart();
    const reads: unknown[] = [];
    const repo = { findActiveBySku: async (...args: unknown[]) => { reads.push(args); return [{ ...promotion, id: "promo", merchantId: "merchant-a", productId: "product-a", isActive: true, startsAt: new Date(0), endsAt: new Date("2099-01-01") }]; } } as unknown as ProductPromotionRepositoryPort;
    const meta = await applyProductPromoPricing(repo, input.merchantId, input, { rules: { maxDiscountPercent: 50, minimumMarginPercent: 0 } as never, costsByVariant: new Map([["variant-a", 10]]) });
    assert.equal(reads.length, 1);
    assert.deepEqual((reads[0] as unknown[]).slice(0, 2), ["merchant-a", "variant-a"]);
    assert.ok((reads[0] as unknown[])[2] instanceof Date);
    assert.equal(input.items[0].unitPriceCents, price);
    assert.equal(input.total, price * 2);
    assert.deepEqual(meta.get("variant-a"), badge);
  });
}

test("application pricing leaves original line prices on promotion read failure", async () => {
  const input = cart();
  const before = structuredClone(input);
  const repo = { findActiveBySku: async () => { throw new Error("synthetic-read-failure"); } } as unknown as ProductPromotionRepositoryPort;
  assert.equal((await applyProductPromoPricing(repo, input.merchantId, input)).size, 0);
  assert.deepEqual(input, before);
});

test("product notice reads remain scoped and preserve missing/non-array behavior", async () => {
  for (const advancedRules of [null, {}, [{ id: "rule-a", enabled: true }]]) {
    const reads: unknown[] = [];
    const prisma = { checkoutSetting: { findUnique: async (query: unknown) => { reads.push(query); return { advancedRules }; } } } as unknown as PrismaClient;
    const rules = await loadProductNoticeRules(prisma, "merchant-a");
    assert.deepEqual(reads, [{ where: { merchantId: "merchant-a" }, select: { advancedRules: true } }]);
    assert.deepEqual(rules, Array.isArray(advancedRules) ? advancedRules : []);
  }
});

test("product notice discount never advertises a raw rule above the current merchant cap", async () => {
  const discountRule = { enabled: true, priority: 1, conditions: [], action: { type: "offer_discount", params: { percent: 50 } } };
  const prisma = { checkoutSetting: { findUnique: async () => ({ advancedRules: [discountRule] }) } } as unknown as PrismaClient;
  const policy = (maxDiscountPercent: number) => ({ getRules: async () => ({ maxDiscountPercent, minimumMarginPercent: 0, allowFreeShipping: false }) }) as never;
  assert.equal((await loadProductNoticeRules(prisma, "m", policy(20)))[0]!.action.params.percent, 20);
  assert.deepEqual(await loadProductNoticeRules(prisma, "m", policy(0)), []);
  assert.deepEqual(await loadProductNoticeRules(prisma, "m"), []);
  assert.equal(discountRule.action.params.percent, 50);
});

test("reevaluation clears stale automatic incentives under the same tenant/session", async () => {
  const input = cart(); input.discount = 1500; input.freeShipping = true;
  const writes: unknown[] = [];
  const clean = { ...structuredClone(input), discount: 0, freeShipping: false };
  const deps = { prisma: { checkoutSetting: { findUnique: async () => ({ advancedRules: [] }) } }, merchantRepo: { getRules: async () => assert.fail("no rules means no merchant policy read") }, cartRepo: { applyRuleOutcome: async (...args: unknown[]) => { writes.push(args); return clean; } } } as unknown as CartRulesDependencies;
  const outcome = await reevaluateCartRules(deps, input.merchantId, input.sessionId, input);
  assert.deepEqual(writes, [["merchant-a", "session-a", { discountCents: 0, freeShipping: false }, input]]);
  assert.equal(outcome.cart, clean);
  assert.equal(outcome.nextNudge, null);
  assert.deepEqual(outcome.activeRules, []);
});

test("reevaluation preserves coupon authority instead of clearing a coupon on cost-read failure", async () => {
  const input = cart(); input.couponCode = "COUPON"; input.discount = 1500;
  const failure = new Error("synthetic-cost-failure");
  const deps = { prisma: { checkoutSetting: { findUnique: async () => ({ advancedRules: [{ enabled: true }] }) }, productPrice: { findMany: async () => { throw failure; } } }, merchantRepo: { getRules: async () => ({ maxDiscountPercent: 20, minimumMarginPercent: 0 }) }, cartRepo: { applyRuleOutcome: async () => assert.fail("must not overwrite coupon authority") } } as unknown as CartRulesDependencies;
  await assert.rejects(reevaluateCartRules(deps, input.merchantId, input.sessionId, input), error => error === failure);
  assert.equal(input.discount, 1500);
});

test("merchandise reevaluation does not revoke an already-authorized coupon shipping benefit", async () => {
  const input = cart(); input.couponCode = "SHIPPING"; input.freeShipping = true;
  const deps = { prisma: { checkoutSetting: { findUnique: async () => ({ advancedRules: [] }) }, productPrice: { findMany: async () => [{ variantId: "variant-a", basePriceInCents: 10000, costInCents: null,
      variant: { productId: "product-a", product: { categoryId: null, metadata: {} } } }] } },
    merchantRepo: { getRules: async () => ({ maxDiscountPercent: 20, minimumMarginPercent: 0, allowFreeShipping: true }) },
    cartRepo: { applyRuleOutcome: async (_merchant: string, _session: string, outcome: { discountCents: number; freeShipping: boolean }) => {
      assert.equal(outcome.discountCents, 0); assert.equal(outcome.freeShipping, true);
      return structuredClone(input);
    } } } as unknown as CartRulesDependencies;
  assert.equal((await reevaluateCartRules(deps, input.merchantId, input.sessionId, input)).cart.freeShipping, true);
});

