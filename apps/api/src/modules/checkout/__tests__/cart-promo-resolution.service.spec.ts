import test from "node:test";
import assert from "node:assert/strict";
import { CartPromoResolutionService } from "../application/services/cart-promo-resolution.service.js";
import type { ProductPromotionRepositoryPort, ProductPromotionEntity, CreateProductPromotionInput } from "../../catalog/domain/ports/product-promotion-repository.port.js";
import type { Cart } from "@zyon/shared-types";

class TestPromoRepo implements ProductPromotionRepositoryPort {
  private data: Map<string, ProductPromotionEntity[]> = new Map();

  async create(input: CreateProductPromotionInput): Promise<ProductPromotionEntity> {
    const promo = {
      id: `promo_${Date.now()}`,
      ...input,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ProductPromotionEntity;
    const key = input.merchantId;
    const existing = this.data.get(key) ?? [];
    this.data.set(key, [...existing, promo]);
    return promo;
  }

  async update() { throw new Error("not implemented"); }
  async getById() { return null; }
  async delete() { }
  async findByProduct() { return []; }
  async findByVariant() { return []; }

  async findActiveByProduct(merchantId: string, productId: string, now?: Date): Promise<ProductPromotionEntity[]> {
    const promos = this.data.get(merchantId) ?? [];
    const checkDate = now ?? new Date();
    return promos.filter(p =>
      p.productId === productId &&
      p.isActive &&
      p.startsAt <= checkDate &&
      checkDate < p.endsAt
    );
  }
}

test("CartPromoResolutionService: applies percent discount", async () => {
  const repo = new TestPromoRepo();
  const service = new CartPromoResolutionService(repo);

  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Create 20% promo on ZYON-SHIRT-001
  await repo.create({
    merchantId: "mrc_1",
    productId: "ZYON-SHIRT-001",
    discountType: "percent",
    discountValue: 20,
    isActive: true,
    startsAt: now,
    endsAt: tomorrow,
  });

  const cart: Cart = {
    currency: "BRL",
    total: 100,
    items: [
      {
        sku: "ZYON-SHIRT-001",
        name: "Test Shirt",
        price: 100,
        quantity: 1,
      },
    ],
  };

  const resolved = await service.resolveCartPromos(cart, "mrc_1", now);

  assert.equal(resolved.items[0]?.price, 80, "should apply 20% discount (100 → 80)");
});

test("CartPromoResolutionService: merchant boundary isolation", async () => {
  const repo = new TestPromoRepo();
  const service = new CartPromoResolutionService(repo);

  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Create promo for mrc_1
  await repo.create({
    merchantId: "mrc_1",
    productId: "ZYON-SHIRT-001",
    discountType: "percent",
    discountValue: 20,
    isActive: true,
    startsAt: now,
    endsAt: tomorrow,
  });

  const cart: Cart = {
    currency: "BRL",
    total: 100,
    items: [
      {
        sku: "ZYON-SHIRT-001",
        name: "Test Shirt",
        price: 100,
        quantity: 1,
      },
    ],
  };

  // Resolve for mrc_2 (should not get the promo)
  const resolved = await service.resolveCartPromos(cart, "mrc_2", now);

  assert.equal(resolved.items[0]?.price, 100, "mrc_2 should not access mrc_1 promo");
});

test("CartPromoResolutionService: coupon promo doesn't change unit price", async () => {
  const repo = new TestPromoRepo();
  const service = new CartPromoResolutionService(repo);

  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Create coupon-linked promo
  await repo.create({
    merchantId: "mrc_1",
    productId: "ZYON-SHIRT-002",
    couponId: "SUMMER20",
    isActive: true,
    startsAt: now,
    endsAt: tomorrow,
  });

  const cart: Cart = {
    currency: "BRL",
    total: 100,
    items: [
      {
        sku: "ZYON-SHIRT-002",
        name: "Coupon Shirt",
        price: 100,
        quantity: 1,
      },
    ],
  };

  const resolved = await service.resolveCartPromos(cart, "mrc_1", now);

  assert.equal(resolved.items[0]?.price, 100, "coupon promo should not change unit price");
});
