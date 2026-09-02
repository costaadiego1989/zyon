import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ConflictException } from "@nestjs/common";
import { AddProductUseCase } from "./add-product.use-case.js";
import { GenerateProductSeoUseCase } from "./generate-product-seo.use-case.js";
import type {
  CreateProductInput,
  ProductRepositoryPort,
  SearchProductsResult,
} from "../../domain/ports/product-repository.port.js";
import { ProductEntity } from "../../domain/entities/product.entity.js";

function makeProduct(overrides: Partial<{ merchantId: string; name: string }> = {}): ProductEntity {
  return new ProductEntity({
    id: "prd_1",
    merchantId: overrides.merchantId ?? "mrc_1",
    name: overrides.name ?? "Test Product",
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    variants: [],
  });
}

function makePortDouble(overrides: Partial<ProductRepositoryPort> = {}): ProductRepositoryPort {
  return {
    create: async () => makeProduct(),
    findById: async () => null,
    search: async (): Promise<SearchProductsResult> => ({ products: [], total: 0 }),
    findExistingVariantSkus: async () => [],
    update: async () => makeProduct(),
    softDelete: async () => undefined,
    addVariant: async () => ({
      id: "var_1",
      sku: "SKU-1",
      attributes: {},
      isActive: true,
      basePriceInCents: 1000,
      taxPercent: 0,
      currency: "BRL",
      stockQuantity: 0,
      stockReserved: 0,
      media: [],
    }),
    ...overrides,
  };
}

function makeSeoDouble(): GenerateProductSeoUseCase {
  return { execute: async () => ({ seoTitle: "t", metaDescription: "d", slug: "s", ogTitle: "o", ogDescription: "od", keywords: [] }) } as any;
}

const validInput: CreateProductInput = {
  merchantId: "mrc_1",
  name: "Widget",
  variants: [{ sku: "SKU-1", attributes: {}, basePriceInCents: 1000 }],
};

describe("AddProductUseCase", () => {
  it("creates a product when input is valid", async () => {
    let captured: CreateProductInput | undefined;
    const repo = makePortDouble({
      create: async (input) => {
        captured = input;
        return makeProduct({ merchantId: input.merchantId, name: input.name });
      },
    });
    const useCase = new AddProductUseCase(repo, makeSeoDouble());

    const result = await useCase.execute(validInput);

    assert.ok(captured, "create should be called");
    assert.equal(captured?.merchantId, "mrc_1");
    assert.equal(result.merchantId, "mrc_1");
    assert.equal(result.name, "Widget");
  });

  it("rejects empty product name", async () => {
    const useCase = new AddProductUseCase(makePortDouble(), makeSeoDouble());
    await assert.rejects(
      () => useCase.execute({ ...validInput, name: "   " }),
      (err: unknown) => err instanceof ConflictException && err.message === "product_name_required",
    );
  });

  it("rejects products without variants", async () => {
    const useCase = new AddProductUseCase(makePortDouble(), makeSeoDouble());
    await assert.rejects(
      () => useCase.execute({ ...validInput, variants: [] }),
      (err: unknown) => err instanceof ConflictException && err.message === "at_least_one_variant_required",
    );
  });

  it("rejects variants missing sku", async () => {
    const useCase = new AddProductUseCase(makePortDouble(), makeSeoDouble());
    await assert.rejects(
      () =>
        useCase.execute({
          ...validInput,
          variants: [{ sku: "  ", attributes: {}, basePriceInCents: 100 }],
        }),
      (err: unknown) => err instanceof ConflictException && err.message === "variant_sku_required",
    );
  });

  it("rejects non-positive base price", async () => {
    const useCase = new AddProductUseCase(makePortDouble(), makeSeoDouble());
    await assert.rejects(
      () =>
        useCase.execute({
          ...validInput,
          variants: [{ sku: "SKU-1", attributes: {}, basePriceInCents: 0 }],
        }),
      (err: unknown) => err instanceof ConflictException && err.message === "price_must_be_positive",
    );
  });
});