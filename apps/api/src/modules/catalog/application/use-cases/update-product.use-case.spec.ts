import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ConflictException } from "@nestjs/common";
import { UpdateProductUseCase } from "./update-product.use-case.js";
import type { ProductRepositoryPort, SearchProductsResult } from "../../domain/ports/product-repository.port.js";
import { ProductEntity } from "../../domain/entities/product.entity.js";

function makeProduct(): ProductEntity {
  return new ProductEntity({
    id: "prd_1",
    merchantId: "mrc_a",
    name: "Product",
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    variants: [],
  });
}

function makeRepository(overrides: Partial<ProductRepositoryPort> = {}): ProductRepositoryPort {
  return {
    create: async () => makeProduct(),
    findById: async () => null,
    search: async (): Promise<SearchProductsResult> => ({ products: [], total: 0 }),
    findExistingVariantSkus: async () => [],
    update: async () => makeProduct(),
    softDelete: async () => undefined,
    addVariant: async () => ({ id: "var_1", sku: "SKU-1", attributes: {}, isActive: true, basePriceInCents: 1000, taxPercent: 0, currency: "BRL", stockQuantity: 0, stockReserved: 0, media: [] }),
    listCategories: async () => [],
    updateVariantBySku: async () => null,
    ...overrides,
  };
}

describe("UpdateProductUseCase", () => {
  it("does not update a product with another merchant's category", async () => {
    let updateCalled = false;
    const useCase = new UpdateProductUseCase(makeRepository({
      listCategories: async () => [{ id: "cat_mrc_a", name: "Owned", slug: "owned", productCount: 0 }],
      update: async () => {
        updateCalled = true;
        return makeProduct();
      },
    }));

    await assert.rejects(
      () => useCase.execute({ merchantId: "mrc_a", productId: "prd_1", categoryId: "cat_mrc_b" }),
      (err: unknown) => err instanceof ConflictException && err.message === "category_not_found",
    );
    assert.equal(updateCalled, false);
  });

  it("updates a product with a category owned by its merchant", async () => {
    let updatedCategoryId: string | undefined;
    const useCase = new UpdateProductUseCase(makeRepository({
      listCategories: async () => [{ id: "cat_mrc_a", name: "Owned", slug: "owned", productCount: 0 }],
      update: async (_merchantId, _productId, data) => {
        updatedCategoryId = data.categoryId;
        return makeProduct();
      },
    }));

    await useCase.execute({ merchantId: "mrc_a", productId: "prd_1", categoryId: "cat_mrc_a" });

    assert.equal(updatedCategoryId, "cat_mrc_a");
  });
});
