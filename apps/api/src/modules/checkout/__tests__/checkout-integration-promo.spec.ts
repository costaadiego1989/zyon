import test from "node:test";
import assert from "node:assert/strict";
import type { ProductPromotionRepositoryPort, ProductPromotionEntity, CreateProductPromotionInput, UpdateProductPromotionInput } from "../../catalog/domain/ports/product-promotion-repository.port.js";
import type { PrismaClient } from "@prisma/client";
import { InMemoryCheckoutRepository } from "../infrastructure/repositories/in-memory-checkout.repository.js";
import { startCheckoutRequest, merchantRules } from "./checkout-test-fixtures.js";
import { createStartCheckoutUseCase } from "../application/use-cases/start-checkout.fixture.js";
import { CheckoutCartAuthorityService } from "../application/services/checkout-cart-authority.service.js";
import { CartPromoResolutionService } from "../application/services/cart-promo-resolution.service.js";
import type { ValidateCartForPaymentUseCase } from "../../commerce/application/validate-cart-for-payment.use-case.js";

// Exercise the real authority/projector before StartCheckout marks the cart validated.
// Fixed server catalog, never derived from the submitted unit price or cost.
function promoCheckout(checkoutRepo: InMemoryCheckoutRepository, promoRepo: ProductPromotionRepositoryPort) {
  const catalog = ["mrc_1", "mrc_2"].flatMap(merchantId => [
    ["ZYON-SHIRT-001", 10000], ["ZYON-SHIRT-002", 10000], ["ZYON-SHIRT-003", 5000],
    ["ZYON-SHIRT-004", 10000], ["ZYON-PANTS-001", 5000],
  ].map(([sku, amount]) => ({ id: String(sku), productId: String(sku), sku: String(sku), isActive: true,
    product: { id: String(sku), merchantId, name: String(sku), type: "physical", isActive: true, deletedAt: null, metadata: {}, categoryId: null },
    price: { basePriceInCents: Number(amount), costInCents: 1000, currency: "BRL" }, stock: [{ quantity: 10, reserved: 0 }], media: [] })));
  const prisma = { productVariant: { async findMany(args: { where: { sku: { in: string[] }; isActive: boolean; product: { merchantId: string; isActive: boolean; deletedAt: null } } }) {
    assert.equal(args.where.isActive, true);
    assert.deepEqual(args.where.product, { merchantId: args.where.product.merchantId, isActive: true, deletedAt: null });
    return catalog.filter(row => row.product.merchantId === args.where.product.merchantId && args.where.sku.in.includes(row.sku));
  } } };
  const rules = { getRules: async () => merchantRules({ maxDiscountPercent: 30, minimumMarginPercent: 38 }) };
  const cartAuthority = new CheckoutCartAuthorityService(prisma as unknown as PrismaClient, {} as ValidateCartForPaymentUseCase,
    new CartPromoResolutionService(promoRepo, rules));
  return createStartCheckoutUseCase(checkoutRepo, checkoutRepo, { promoRepository: promoRepo, cartAuthority });
}

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

  async update(id: string, merchantId: string, input: UpdateProductPromotionInput): Promise<ProductPromotionEntity> {
    const key = `${merchantId}`;
    const promos = this.promotions.get(key) ?? [];
    const index = promos.findIndex((p) => p.id === id);
    if (index === -1) throw new Error("promotion_not_found");
    const updated = { ...promos[index]!, ...input, updatedAt: new Date() };
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

  async findActiveBySku(merchantId: string, sku: string, now?: Date): Promise<ProductPromotionEntity[]> {
    // Explicit fixture stable ID equals SKU; runtime lookup is tenant-scoped.
    const key = `${merchantId}`;
    const promos = this.promotions.get(key) ?? [];
    const checkDate = now ?? new Date();
    return promos.filter(
      (p) =>
        (p.productId === sku || p.variantId === sku) &&
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

  const useCase = promoCheckout(checkoutRepo, promoRepo);

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

  const useCase = promoCheckout(checkoutRepo, promoRepo);

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

  const useCase = promoCheckout(checkoutRepo, promoRepo);

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

  // Promo 2: Fixed R$10 off ZYON-PANTS-001 — discountValue is in CENTS (1000 = R$10)
  await promoRepo.create({
    merchantId: "mrc_1",
    productId: "ZYON-PANTS-001",
    discountType: "fixed",
    discountValue: 1000,
    isActive: true,
    startsAt: now,
    endsAt: tomorrow,
  });

  const useCase = promoCheckout(checkoutRepo, promoRepo);

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

  const useCase = promoCheckout(checkoutRepo, promoRepo);

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

  const useCase = promoCheckout(checkoutRepo, promoRepo);

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
