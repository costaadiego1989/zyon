import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NotFoundException } from "@nestjs/common";
import { ProductPromotionController } from "./product-promotion.controller.js";
import type { ProductPromotionEntity } from "../../domain/ports/product-promotion-repository.port.js";

const merchantId = "merchant-a";
const productId = "product-a";

function promotion(overrides: Partial<ProductPromotionEntity> = {}): ProductPromotionEntity {
  return {
    id: "promotion-a",
    merchantId,
    productId,
    variantId: null,
    categoryId: null,
    couponId: null,
    discountType: "percent",
    discountValue: 15,
    promoPriceInCents: null,
    isActive: true,
    startsAt: new Date("2026-09-01T00:00:00.000Z"),
    endsAt: new Date("2026-10-01T00:00:00.000Z"),
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-02T00:00:00.000Z"),
    ...overrides,
  };
}

function makeController({
  savedPromotions = [promotion()],
  getProduct = async () => ({ id: productId }),
}: {
  savedPromotions?: ProductPromotionEntity[];
  getProduct?: (merchant: string, product: string) => Promise<unknown>;
} = {}) {
  const calls = {
    findByProduct: [] as Array<[string, string]>,
    getById: [] as Array<[string, string]>,
    update: 0,
    toggle: 0,
    remove: 0,
  };
  const repo = {
    findByProduct: async (merchant: string, product: string) => {
      calls.findByProduct.push([merchant, product]);
      return savedPromotions;
    },
    getById: async (id: string, merchant: string) => {
      calls.getById.push([id, merchant]);
      return savedPromotions.find((item) => item.id === id) ?? null;
    },
  };
  const toggle = {
    execute: async ({ id, isActive }: { id: string; merchantId: string; isActive: boolean }) => {
      calls.toggle += 1;
      return promotion({ id, isActive });
    },
  };
  const remove = {
    execute: async () => { calls.remove += 1; },
  };
  const controller = new ProductPromotionController(
    { execute: async () => promotion() } as any,
    { execute: async () => { calls.update += 1; return promotion(); } } as any,
    toggle as any,
    remove as any,
    { get: async () => [], execute: async () => [] } as any,
    { execute: getProduct } as any,
    repo as any,
  );
  return { controller, calls };
}

describe("ProductPromotionController simple promotions", () => {
  it("lists only promotions for the requested merchant and product", async () => {
    const { controller, calls } = makeController();

    const result = await controller.list(merchantId, productId);

    assert.equal(result.promotions.length, 1);
    assert.equal(result.promotions[0].id, "promotion-a");
    assert.deepEqual(calls.findByProduct, [[merchantId, productId]]);
  });

  it("does not query promotion rows when the product is outside the merchant scope", async () => {
    const { controller, calls } = makeController({
      getProduct: async () => { throw new NotFoundException("product_not_found"); },
    });

    await assert.rejects(
      () => controller.list(merchantId, "foreign-product"),
      (error: unknown) => error instanceof NotFoundException,
    );
    assert.equal(calls.findByProduct.length, 0);
  });

  it("rejects update, toggle, and delete through a different product path", async () => {
    const { controller, calls } = makeController({
      savedPromotions: [promotion({ productId: "product-b" })],
    });

    for (const operation of [
      () => controller.update(merchantId, productId, "promotion-a", {}),
      () => controller.toggle(merchantId, productId, "promotion-a", { isActive: false }),
      () => controller.remove(merchantId, productId, "promotion-a"),
    ]) {
      await assert.rejects(operation, (error: unknown) => error instanceof NotFoundException);
    }

    assert.equal(calls.update, 0);
    assert.equal(calls.toggle, 0);
    assert.equal(calls.remove, 0);
  });

  it("returns the toggled promotion and the deletion contract expected by the dashboard", async () => {
    const { controller, calls } = makeController();

    const toggled = await controller.toggle(merchantId, productId, "promotion-a", { isActive: false });
    const deleted = await controller.remove(merchantId, productId, "promotion-a");

    assert.equal(toggled.isActive, false);
    assert.deepEqual(deleted, { deleted: true });
    assert.equal(calls.toggle, 1);
    assert.equal(calls.remove, 1);
  });
});
