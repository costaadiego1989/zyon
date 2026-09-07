import assert from "node:assert/strict";
import test from "node:test";
import { CouponEntity } from "../../../coupons/domain/entities/coupon.entity.js";
import { GetPublicStoreResourcesUseCase } from "./get-public-store-resources.use-case.js";

const merchant = {
  id: "mrc_demo",
  name: "Demo",
  storeSettings: { slug: "demo" },
  theme: { logoUrl: "https://cdn.example.com/logo.png" },
};

test("public storefront resources resolve a verified custom domain through ports", async () => {
  const active = CouponEntity.create({
    merchant_id: merchant.id,
    code: "WELCOME",
    discount_type: "percent",
    discount_value: 10,
    min_cart_total: null,
    max_usages: null,
    max_per_buyer: null,
    allowed_skus: [],
    blocked_skus: [],
    allowed_regions: [],
    blocked_regions: [],
    starts_at: new Date(Date.now() - 60_000).toISOString(),
    ends_at: null,
  });
  const useCase = new GetPublicStoreResourcesUseCase(
    {
      findBySlug: async (slug: string) => slug === "demo" ? merchant : undefined,
      findByCustomDomain: async (host: string) => host === "loja.exemplo.com" ? merchant : undefined,
      listPublicStores: async () => [{ slug: "demo", updatedAt: "2026-09-07T00:00:00.000Z" }],
    } as any,
    { listPublicStories: async (merchantId: string) => merchantId === merchant.id ? [{ id: "story_1" }] : [] } as any,
    { findAllByMerchant: async () => [active] } as any,
  );

  assert.deepEqual(await useCase.listIndex(), { stores: [{ slug: "demo", updatedAt: "2026-09-07T00:00:00.000Z" }] });
  assert.deepEqual(await useCase.storiesForSlug("loja.exemplo.com"), { categories: [{ id: "story_1" }] });
  assert.equal(await useCase.logoForSlug("demo"), "https://cdn.example.com/logo.png");
  assert.deepEqual((await useCase.couponsForSlug("demo")).items.map((coupon) => coupon.code), ["WELCOME"]);
});
