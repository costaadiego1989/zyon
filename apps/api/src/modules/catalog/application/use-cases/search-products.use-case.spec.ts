import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SearchProductsUseCase } from "./search-products.use-case.js";
import { EmbeddingService } from "../../infrastructure/services/embedding.service.js";
import type {
  ProductRepositoryPort,
  SearchProductsInput,
  SearchProductsResult,
} from "../../domain/ports/product-repository.port.js";
import type { PrismaClient } from "@prisma/client";
import { ProductEntity } from "../../domain/entities/product.entity.js";

function makeProduct(id: string): ProductEntity {
  return new ProductEntity({
    id,
    merchantId: "mrc_1",
    name: `P-${id}`,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    variants: [],
  });
}

function makePortDouble(overrides: Partial<ProductRepositoryPort> = {}): ProductRepositoryPort {
  return {
    create: async () => makeProduct("prd_new"),
    findById: async () => null,
    search: async (): Promise<SearchProductsResult> => ({ products: [], total: 0 }),
    update: async () => makeProduct("prd_1"),
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

describe("SearchProductsUseCase", () => {
  it("forwards search input and returns repository result", async () => {
    let captured: SearchProductsInput | undefined;
    const repo = makePortDouble({
      search: async (input) => {
        captured = input;
        return { products: [makeProduct("prd_a"), makeProduct("prd_b")], total: 2 };
      },
    });
    const embService = new EmbeddingService();
    const mockPrisma = {} as PrismaClient;
    const useCase = new SearchProductsUseCase(repo, embService, mockPrisma);

    const result = await useCase.execute({ merchantId: "mrc_1", query: "shoe" });

    assert.ok(captured, "search should be called");
    assert.equal(captured?.merchantId, "mrc_1");
    assert.equal(captured?.query, "shoe");
    assert.equal(result.products.length, 2);
    assert.equal(result.total, 2);
  });

  it("caps limit to 100 even when caller requests more", async () => {
    let captured: SearchProductsInput | undefined;
    const repo = makePortDouble({
      search: async (input) => {
        captured = input;
        return { products: [], total: 0 };
      },
    });
    const embService = new EmbeddingService();
    const mockPrisma = {} as PrismaClient;
    const useCase = new SearchProductsUseCase(repo, embService, mockPrisma);

    await useCase.execute({ merchantId: "mrc_1", limit: 250 });

    assert.equal(captured?.limit, 100);
  });

  it("defaults limit to 20 when caller omits it", async () => {
    let captured: SearchProductsInput | undefined;
    const repo = makePortDouble({
      search: async (input) => {
        captured = input;
        return { products: [], total: 0 };
      },
    });
    const embService = new EmbeddingService();
    const mockPrisma = {} as PrismaClient;
    const useCase = new SearchProductsUseCase(repo, embService, mockPrisma);

    await useCase.execute({ merchantId: "mrc_1" });

    assert.equal(captured?.limit, 20);
  });
});