import test from "node:test";
import assert from "node:assert/strict";
import type { ProductPromotionRepositoryPort, ProductPromotionEntity, CreateProductPromotionInput } from "../../catalog/domain/ports/product-promotion-repository.port.js";
import { InMemoryCheckoutRepository } from "../infrastructure/repositories/in-memory-checkout.repository.js";
import { startCheckoutRequest } from "./checkout-test-fixtures.js";
import { createStartCheckoutUseCase } from "../application/use-cases/start-checkout.fixture.js";

// In-memory product promotion repository for testing
class InMemoryProductPromotionRepository implements ProductPromotionRepositoryPort {
  private promotions: Map<string, ProductPromotionEntity[]> = new Map();

  async create(input: CreateProductPromotionInput): Promise<ProductPromotionEntity> {
    const promo = {
      id: `promo_${Date.now()}`,
      ...input,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ProductPromotionEntity;
    const key = `${input.merchantId}`;
    const existing = this.promotions.get(key) ?? [];
    this.promotions.set(key, [...existing, promo]);
    return promo;
  }

  async update(id: string, merchantId: string, input: any): Promise<ProductPromotionEntity> {
    const key = `${merchantId}`;
    const promos = this.promotions.get(key) ?? [];
    const index = promos.findIndex((p) => p.id === id);
    if (index === -1) throw new Error("promotion_not_found");
    const updated = { ...promos[index], ...input, updatedAt: new Date() };
    promos[index] = updated;
    return updated;
  }

  async getById(id: string, merchantId: string): Promise<ProductPromotionEntity | null> {
    const key = `${merchantId}`;
    const promos = this.promotions.get(key) ?? [];
    return promos.find((p) => p.id === id) ?? null;
  }

  async delete(id: string, merchantId: string): Promise<void> {
    const key = `${merchantId}`;
    const promos = this.promotions.get(key) ?? [];
    const index = promos.findIndex((p) => p.id === id);
    if (index !== -1) promos.splice(index, 1);
  }

  async findByProduct(merchantId: string, productId: string): Promise<ProductPromotionEntity[]> {
    const key = `${merchantId}`;
    const promos = this.promotions.get(key) ?? [];
    return promos.filter((p) => p.productId === productId);
  }

  async findByVariant(merchantId: string, variantId: string): Promise<ProductPromotionEntity[]> {
    const key = `${merchantId}`;
    const promos = this.promotions.get(key) ?? [];
    return promos.filter((p) => p.variantId === variantId);
  }

  async findActiveByProduct(merchantId: string, productId: string, now?: Date): Promise<ProductPromotionEntity[]> {
    const key = `${merchantId}`;
    const promos = this.promotions.get(key) ?? [];
    const checkDate = now ?? new Date();
    return promos.filter(
      (p) =>
        p.productId === productId &&
        p.isActive &&
        p.startsAt <= checkDate &&
        checkDate < p.endsAt
    );
  }
}

test("StartCheckout with product promo: resolves unit_price via promo resolver", async () => {
  const checkoutRepo = new InMemoryCheckoutRepository();
  const promoRepo = new InMemoryProductPromotionRepository();

  // Create an active percent-discount promo: 20% off product ZYON-SHIRT-001
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  await promoRepo.create({
    merchantId: "mrc_1",
    productId: "ZYON-SHIRT-001",
    discountType: "percent",
    discountValue: 20,
    isActive: true,
    startsAt: now,
    endsAt: tomorrow,
  });

  const useCase = createStartCheckoutUseCase(checkoutRepo, checkoutRepo, {
    promoRepository: promoRepo,
  });

  // Start checkout with a cart line that matches the promo
  const response = await useCase.execute(
    startCheckoutRequest({
      session_id: "chk_promo_percent",
      cart: {
        currency: "BRL",
        total: 100,
        items: [
          {
            sku: "ZYON-SHIRT-001",
            name: "Test Shirt",
            price: 100, // Base price in reais (100 reais = 10000 cents)
            quantity: 1,
          },
        ],
      },
    })
  );

  // Assert: unit_price should be 80 (after 20% discount from 100)
  assert.equal(
    response.experience.items[0]?.unit_price,
    80,
    "unit_price should reflect 20% promo discount (100 → 80)"
  );
  assert.equal(response.experience.items[0]?.sku, "ZYON-SHIRT-001");
});

test("StartCheckout with coupon promo: unit_price unchanged, no fabricated discount", async () => {
  const checkoutRepo = new InMemoryCheckoutRepository();
  const promoRepo = new InMemoryProductPromotionRepository();

  // Create a coupon-linked promo (should NOT affect unit_price)
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  await promoRepo.create({
    merchantId: "mrc_1",
    productId: "ZYON-SHIRT-002",
    couponId: "SUMMER20",
    isActive: true,
    startsAt: now,
    endsAt: tomorrow,
  });

  const useCase = createStartCheckoutUseCase(checkoutRepo, checkoutRepo, {
    promoRepository: promoRepo,
  });

  const response = await useCase.execute(
    startCheckoutRequest({
      session_id: "chk_coupon_promo",
      cart: {
        currency: "BRL",
        total: 100,
        items: [
          {
            sku: "ZYON-SHIRT-002",
            name: "Coupon Test Shirt",
            price: 100,
            quantity: 1,
          },
        ],
      },
    })
  );

  // Assert: unit_price should remain 100 (coupon doesn't affect unit price)
  assert.equal(
    response.experience.items[0]?.unit_price,
    100,
    "coupon-linked promo should not reduce unit_price"
  );
});

test("StartCheckout without promo: unit_price = base price", async () => {
  const checkoutRepo = new InMemoryCheckoutRepository();
  const promoRepo = new InMemoryProductPromotionRepository();

  const useCase = createStartCheckoutUseCase(checkoutRepo, checkoutRepo, {
    promoRepository: promoRepo,
  });

  const response = await useCase.execute(
    startCheckoutRequest({
      session_id: "chk_no_promo",
      cart: {
        currency: "BRL",
        total: 50,
        items: [
          {
            sku: "ZYON-SHIRT-003",
            name: "No Promo Shirt",
            price: 50,
            quantity: 1,
          },
        ],
      },
    })
  );

  // Assert: unit_price should be 50 (no promo applied)
  assert.equal(response.experience.items[0]?.unit_price, 50);
});

test("StartCheckout with multiple lines: each resolved independently", async () => {
  const checkoutRepo = new InMemoryCheckoutRepository();
  const promoRepo = new InMemoryProductPromotionRepository();

  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Promo 1: 20% off ZYON-SHIRT-001
  await promoRepo.create({
    merchantId: "mrc_1",
    productId: "ZYON-SHIRT-001",
    discountType: "percent",
    discountValue: 20,
    isActive: true,
    startsAt: now,
    endsAt: tomorrow,
  });

  // Promo 2: Fixed 10 reais off ZYON-PANTS-001
  await promoRepo.create({
    merchantId: "mrc_1",
    productId: "ZYON-PANTS-001",
    discountType: "fixed",
    discountValue: 10,
    isActive: true,
    startsAt: now,
    endsAt: tomorrow,
  });

  const useCase = createStartCheckoutUseCase(checkoutRepo, checkoutRepo, {
    promoRepository: promoRepo,
  });

  const response = await useCase.execute(
    startCheckoutRequest({
      session_id: "chk_multi_line",
      cart: {
        currency: "BRL",
        total: 150,
        items: [
          {
            sku: "ZYON-SHIRT-001",
            name: "Shirt with % promo",
            price: 100,
            quantity: 1,
          },
          {
            sku: "ZYON-PANTS-001",
            name: "Pants with fixed promo",
            price: 50,
            quantity: 1,
          },
        ],
      },
    })
  );

  // Shirt: 100 - 20% = 80
  assert.equal(response.experience.items[0]?.unit_price, 80);
  // Pants: 50 - 10 = 40
  assert.equal(response.experience.items[1]?.unit_price, 40);
});

test("StartCheckout with promo: merchant boundary enforced (cross-merchant access denied)", async () => {
  const checkoutRepo = new InMemoryCheckoutRepository();
  const promoRepo = new InMemoryProductPromotionRepository();

  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Create promo for mrc_1
  await promoRepo.create({
    merchantId: "mrc_1",
    productId: "ZYON-SHIRT-001",
    discountType: "percent",
    discountValue: 20,
    isActive: true,
    startsAt: now,
    endsAt: tomorrow,
  });

  const useCase = createStartCheckoutUseCase(checkoutRepo, checkoutRepo, {
    promoRepository: promoRepo,
  });

  // Start checkout for mrc_2 with same product
  const response = await useCase.execute(
    startCheckoutRequest({
      session_id: "chk_boundary_check",
      merchant_id: "mrc_2", // Different merchant
      cart: {
        currency: "BRL",
        total: 100,
        items: [
          {
            sku: "ZYON-SHIRT-001",
            name: "Shirt",
            price: 100,
            quantity: 1,
          },
        ],
      },
    })
  );

  // Assert: mrc_2 should NOT get the promo (merchant boundary enforced)
  assert.equal(
    response.experience.items[0]?.unit_price,
    100,
    "mrc_2 should not access mrc_1 promo"
  );
});

test("StartCheckout with inline price promo: resolves to promo price", async () => {
  const checkoutRepo = new InMemoryCheckoutRepository();
  const promoRepo = new InMemoryProductPromotionRepository();

  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Create promo with explicit price: 75 reais (instead of 100)
  await promoRepo.create({
    merchantId: "mrc_1",
    productId: "ZYON-SHIRT-004",
    promoPriceInCents: 7500, // 75 reais in cents
    isActive: true,
    startsAt: now,
    endsAt: tomorrow,
  });

  const useCase = createStartCheckoutUseCase(checkoutRepo, checkoutRepo, {
    promoRepository: promoRepo,
  });

  const response = await useCase.execute(
    startCheckoutRequest({
      session_id: "chk_inline_price",
      cart: {
        currency: "BRL",
        total: 100,
        items: [
          {
            sku: "ZYON-SHIRT-004",
            name: "Promo Price Shirt",
            price: 100,
            quantity: 1,
          },
        ],
      },
    })
  );

  // Assert: unit_price should be 75 (from promoPriceInCents)
  assert.equal(response.experience.items[0]?.unit_price, 75);
});
