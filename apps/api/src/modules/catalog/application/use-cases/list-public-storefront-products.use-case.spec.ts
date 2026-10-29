import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ProductRepositoryPort, SearchProductsInput } from "../../domain/ports/product-repository.port.js";
import { ListPublicStorefrontProductsUseCase } from "./list-public-storefront-products.use-case.js";

const product = {
  id: "product-1",
  merchantId: "merchant-1",
  name: "Camiseta",
  description: "Algodão",
  type: "physical",
  isActive: true,
  averageRating: 4.5,
  reviewCount: 8,
  variants: [
    {
      id: "variant-1",
      sku: "CAM-P",
      attributes: { tamanho: "P" },
      isActive: true,
      basePriceInCents: 12990,
      costInCents: 5000,
      barcode: "secret-barcode",
      currency: "BRL",
      stockQuantity: 3,
      stockReserved: 1,
      taxPercent: 0,
      media: [{ id: "media-1", url: "https://cdn.example/camiseta.png", type: "IMAGE", order: 0 }],
    },
  ],
};

describe("ListPublicStorefrontProductsUseCase", () => {
  it("returns a bounded public projection with BRL values", async () => {
    let captured: SearchProductsInput | undefined;
    const products = makeRepository({
      search: async (input) => {
        captured = input;
        return { products: [product] as never[], nextCursor: "product-2", total: 1 };
      },
    });
    const useCase = new ListPublicStorefrontProductsUseCase(products);

    assert.deepEqual(await useCase.execute({ merchantId: "merchant-1", limit: 100 }), {
      products: [{
        id: "product-1",
        name: "Camiseta",
        description: "Algodão",
        type: "physical",
        price: 129.9,
        currency: "BRL",
        image: "https://cdn.example/camiseta.png",
        images: ["https://cdn.example/camiseta.png"],
        inStock: true,
        rating: 4.5,
        reviewCount: 8,
        variants: [{ id: "variant-1", value: "P" }],
      }],
      nextCursor: "product-2",
    });
    assert.deepEqual(captured, {
      merchantId: "merchant-1",
      query: undefined,
      categoryId: undefined,
      cursor: undefined,
      limit: 50,
      isActiveOnly: true,
    });
  });

  it("does not expose inactive products by id", async () => {
    const products = makeRepository({ findById: async () => ({ ...product, isActive: false }) as never });
    const useCase = new ListPublicStorefrontProductsUseCase(products);

    await assert.rejects(() => useCase.get("merchant-1", "product-1"), { message: "storefront_product_not_found" });
  });
});

function makeRepository(overrides: Partial<ProductRepositoryPort>): ProductRepositoryPort {
  return {
    create: async () => product as never,
    findById: async () => null,
    search: async () => ({ products: [], total: 0 }),
    findExistingVariantSkus: async () => [],
    update: async () => product as never,
    softDelete: async () => undefined,
    addVariant: async () => product.variants[0] as never,
    listCategories: async () => [],
    updateVariantBySku: async () => null,
    ...overrides,
  };
}
