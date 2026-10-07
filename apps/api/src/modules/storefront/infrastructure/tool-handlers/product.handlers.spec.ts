import assert from "node:assert/strict";
import test from "node:test";
import { ProductEntity } from "../../../catalog/domain/entities/product.entity.js";
import { createProductHandlers } from "./product.handlers.js";

test("public categories consume active flat counts without an unrelated catalog query", async () => {
  const handlers = createProductHandlers({ productRepo: {
    search: async () => { assert.fail("no unrelated search"); },
    listCategories: async (merchantId: string, options: unknown) => {
      assert.equal(merchantId, "merchant_1"); assert.deepEqual(options, { publicOnly: true });
      return [{ id: "category", name: "QA", slug: "qa", productCount: 3, _count: { products: 9 } }];
    },
  } } as never, { merchantId: "merchant_1", sessionId: "session" });
  assert.deepEqual(await handlers.listCategories(), { categories: [{ id: "category", name: "QA", slug: "qa", productCount: 3 }] });
});
test("digital detail describes availability without a misleading physical stock zero", async () => {
  const digital = new ProductEntity({ ...product("download", "Arquivo"), type: "digital", metadata: { downloadUrl: "https://example.test/file.pdf" },
    variants: product("download", "Arquivo").variants.map(variant => ({ ...variant, stockQuantity: 0 })) });
  const handlers = createProductHandlers({ prisma: { checkoutSetting: { findUnique: async () => null } }, productRepo: { findById: async () => digital } } as never, { merchantId: "merchant_1", sessionId: "session" });
  const result = await handlers.getProductDetails({ productId: "download" }) as any;
  assert.equal(result.product.stock, null); assert.equal(result.product.inStock, true);
});

test("availability scopes the variant to the active merchant before reading stock", async () => {
  let stockReads = 0;
  const handlers = createProductHandlers({
    prisma: { productVariant: { findFirst: async ({ where }: any) => {
      assert.deepEqual(where, { id: "foreign", isActive: true, product: { merchantId: "merchant_1", isActive: true, deletedAt: null } });
      return null;
    } } }, stockRepo: { getAvailableStock: async () => { stockReads++; return { quantity: 100, reserved: 0 }; } },
  } as never, { merchantId: "merchant_1", sessionId: "session" });
  assert.deepEqual(await handlers.getProductAvailability({ variantId: "foreign" }), { error: "product_not_found", inStock: false, quantity: 0 });
  assert.equal(stockReads, 0);
});
test("digital availability requires content and services do not promise stock or immediate execution", async () => {
  for (const [type, metadata, available] of [["digital", {}, false], ["digital", { downloadUrl: "https://example.com/file.pdf" }, true], ["service", {}, true]] as const) {
    const handlers = createProductHandlers({
      prisma: { productVariant: { findFirst: async () => ({ product: { type, metadata } }) } },
      stockRepo: { getAvailableStock: async () => { throw Error("nonphysical_stock_read"); } },
    } as never, { merchantId: "merchant_1", sessionId: "session" });
    const result = await handlers.getProductAvailability({ variantId: "own" }) as any;
    assert.equal(result.inStock, available); assert.equal(result.quantity, null);
    assert.notEqual(result.estimatedShipping, "Entrega imediata"); assert.equal(JSON.stringify(result).includes("file.pdf"), false);
  }
});
test("physical and food availability exclude reserved quantities", async () => {
  for (const type of ["physical", "food"]) {
    const handlers = createProductHandlers({
      prisma: { productVariant: { findFirst: async () => ({ product: { type } }) } },
      stockRepo: { getAvailableStock: async () => ({ quantity: 5, reserved: 5 }) },
    } as never, { merchantId: "merchant_1", sessionId: "session" });
    const result = await handlers.getProductAvailability({ variantId: "own" }) as any;
    assert.equal(result.inStock, false); assert.equal(result.quantity, 0);
  }
});

function product(id: string, name: string, categoryId = "care") {
  return new ProductEntity({
    id,
    merchantId: "merchant_1",
    name,
    categoryId,
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    variants: [{
      id: `${id}_variant`,
      sku: `${id}-sku`,
      attributes: { material: "Algodão" },
      isActive: true,
      basePriceInCents: 9900,
      taxPercent: 0,
      currency: "BRL",
      stockQuantity: 4,
      stockReserved: 0,
      media: [],
    }],
  });
}

test("compares the current product with confirmed similar products", async () => {
  const current = product("p1", "Camiseta básica");
  const similar = product("p2", "Camiseta premium");
  const handlers = createProductHandlers({
    productRepo: {
      findById: async (_merchantId: string, id: string) => id === current.id ? current : null,
      search: async (input: { categoryId?: string }) => ({
        products: input.categoryId === "care" ? [current, similar] : [],
        total: 2,
      }),
    },
  } as never, { merchantId: "merchant_1", sessionId: "conversation_1" });

  const result = await handlers.compareProducts({ productId: current.id }) as {
    comparison: Array<{ id: string }>;
    requiresProductNames: boolean;
  };

  assert.deepEqual(result.comparison.map((item) => item.id), ["p1", "p2"]);
  assert.equal(result.requiresProductNames, false);
});

test("compares only exact product names when the buyer names both products", async () => {
  const first = product("p1", "Camiseta básica");
  const second = product("p2", "Camiseta premium");
  const byName = new Map([[first.name, first], [second.name, second]]);
  const handlers = createProductHandlers({
    productRepo: {
      findById: async () => null,
      search: async (input: { query?: string }) => ({
        products: input.query ? [byName.get(input.query)!].filter(Boolean) : [],
        total: 1,
      }),
    },
  } as never, { merchantId: "merchant_1", sessionId: "conversation_1" });

  const result = await handlers.compareProducts({
    productNames: [first.name, second.name],
    includeSimilar: false,
  }) as { comparison: Array<{ name: string }>; missingProductNames: string[] };

  assert.deepEqual(result.comparison.map((item) => item.name), [first.name, second.name]);
  assert.deepEqual(result.missingProductNames, []);
});
