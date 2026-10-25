import test from "node:test";
import assert from "node:assert/strict";
import { ProductFeedService } from "./product-feed.service.js";
import type {
  ProductRepositoryPort,
  SearchProductsInput,
  SearchProductsResult,
} from "../../catalog/domain/ports/product-repository.port.js";
import { ProductEntity } from "../../catalog/domain/entities/product.entity.js";
import type { MerchantRepository } from "../../merchant/domain/ports/merchant-repository.port.js";

function makeProduct(id: string, priceCents = 19990): ProductEntity {
  return new ProductEntity({
    id,
    merchantId: "mrc_1",
    name: `Product ${id}`,
    description: `Description ${id}`,
    slug: `product-${id}`,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    variants: [
      {
        id: `var_${id}`,
        sku: `SKU-${id}`,
        attributes: {},
        isActive: true,
        basePriceInCents: priceCents,
        taxPercent: 0,
        currency: "BRL",
        stockQuantity: 5,
        stockReserved: 0,
        media: [{ id: `m_${id}`, url: `https://cdn/${id}.jpg`, type: "IMAGE", order: 0 }],
      },
    ],
  });
}

function makeProductRepo(
  pages: SearchProductsResult[],
): { repo: ProductRepositoryPort; calls: SearchProductsInput[] } {
  const calls: SearchProductsInput[] = [];
  let pageIndex = 0;
  const repo: ProductRepositoryPort = {
    create: async () => makeProduct("new"),
    findById: async () => null,
    search: async (input): Promise<SearchProductsResult> => {
      calls.push(input);
      const page = pages[pageIndex] ?? { products: [], total: 0 };
      pageIndex += 1;
      return page;
    },
    findExistingVariantSkus: async () => [],
    update: async () => makeProduct("upd"),
    softDelete: async () => undefined,
    addVariant: async () => ({
      id: "v",
      sku: "s",
      attributes: {},
      isActive: true,
      basePriceInCents: 1,
      taxPercent: 0,
      currency: "BRL",
      stockQuantity: 0,
      stockReserved: 0,
      media: [],
    }),
    listCategories: async () => [],
    updateVariantBySku: async () => null,
  };
  return { repo, calls };
}

function makeMerchantRepo(name?: string): MerchantRepository {
  return {
    getProfile: async (id) => (name ? { id, name } : undefined),
    getStripeConnectAccountId: async () => undefined,
    setStripeConnectAccountId: async () => undefined,
    getRules: async () => ({} as never),
    updateRules: async () => ({} as never),
    updateTheme: async () => ({} as never),
    updateStoreCategory: async () => undefined,
    getStoreSettings: async () => ({}),
    updateStoreSettings: async () => ({}),
  };
}

async function drain(stream: NodeJS.ReadableStream): Promise<string> {
  let out = "";
  for await (const chunk of stream) out += chunk.toString();
  return out;
}

test("ProductFeedService streams CSV with header + all products", async () => {
  const { repo } = makeProductRepo([
    { products: [makeProduct("1"), makeProduct("2")], total: 2 },
  ]);
  const service = new ProductFeedService(repo, makeMerchantRepo("MyBrand"));

  const result = await service.stream({ merchantId: "mrc_1", format: "csv" });
  assert.equal(result.contentType, "text/csv; charset=utf-8");

  const csv = await drain(result.stream);
  const lines = csv.split("\n").filter((l) => l.length > 0);
  assert.equal(lines.length, 3, "header + 2 rows");
  assert.ok(lines[0].startsWith("id,title,description"));
  assert.ok(lines[1].includes("MyBrand"), "brand from merchant profile");
});

test("ProductFeedService streams NDJSON when format=json", async () => {
  const { repo } = makeProductRepo([{ products: [makeProduct("1")], total: 1 }]);
  const service = new ProductFeedService(repo, makeMerchantRepo("Brand"));

  const result = await service.stream({ merchantId: "mrc_1", format: "json" });
  assert.equal(result.contentType, "application/x-ndjson; charset=utf-8");

  const ndjson = await drain(result.stream);
  const lines = ndjson.split("\n").filter((l) => l.length > 0);
  assert.equal(lines.length, 1);

  const obj = JSON.parse(lines[0]);
  assert.equal(obj.id, "1");
  assert.equal(obj.title, "Product 1");
  assert.equal(obj.price, "199.90 BRL");
  assert.equal(obj.availability, "in_stock");
  for (const f of [
    "id",
    "title",
    "description",
    "link",
    "image_link",
    "availability",
    "price",
    "brand",
    "currency",
  ]) {
    assert.ok(f in obj, `missing field ${f}`);
  }
});

test("ProductFeedService follows cursor across multiple pages", async () => {
  const { repo, calls } = makeProductRepo([
    { products: [makeProduct("1")], total: 3, nextCursor: "cur_1" },
    { products: [makeProduct("2")], total: 3, nextCursor: "cur_2" },
    { products: [makeProduct("3")], total: 3 },
  ]);
  const service = new ProductFeedService(repo, makeMerchantRepo("Brand"));

  const result = await service.stream({ merchantId: "mrc_1", format: "json" });
  const ndjson = await drain(result.stream);
  const lines = ndjson.split("\n").filter((l) => l.length > 0);

  assert.equal(lines.length, 3, "all products across pages");
  assert.equal(calls.length, 3, "three repo calls");
  assert.equal(calls[1].cursor, "cur_1");
  assert.equal(calls[2].cursor, "cur_2");
  assert.equal(result.pagination.hasMore, false);
  assert.equal(result.pagination.nextCursor, null);
});

test("ProductFeedService caps limit at 5000", async () => {
  const { repo, calls } = makeProductRepo([{ products: [], total: 0 }]);
  const service = new ProductFeedService(repo, makeMerchantRepo("Brand"));

  await service.stream({ merchantId: "mrc_1", format: "csv", limit: 999999 });
  assert.equal(calls[0].limit, 5000);
});

test("ProductFeedService uses default limit 1000 when unspecified", async () => {
  const { repo, calls } = makeProductRepo([{ products: [], total: 0 }]);
  const service = new ProductFeedService(repo, makeMerchantRepo("Brand"));

  await service.stream({ merchantId: "mrc_1", format: "csv" });
  assert.equal(calls[0].limit, 1000);
});

test("ProductFeedService passes cursor through to first repo call", async () => {
  const { repo, calls } = makeProductRepo([{ products: [], total: 0 }]);
  const service = new ProductFeedService(repo, makeMerchantRepo("Brand"));

  await service.stream({ merchantId: "mrc_1", format: "csv", cursor: "seed_cursor" });
  assert.equal(calls[0].cursor, "seed_cursor");
});

test("ProductFeedService falls back to merchant id when profile missing", async () => {
  const { repo } = makeProductRepo([{ products: [makeProduct("1")], total: 1 }]);
  const service = new ProductFeedService(repo, makeMerchantRepo());

  const result = await service.stream({ merchantId: "mrc_noprofile", format: "json" });
  const ndjson = await drain(result.stream);
  const obj = JSON.parse(ndjson.split("\n")[0]);
  assert.equal(obj.brand, "mrc_noprofile");
});

test("ProductFeedService throws when merchantId is empty", async () => {
  const { repo } = makeProductRepo([{ products: [], total: 0 }]);
  const service = new ProductFeedService(repo, makeMerchantRepo("Brand"));

  await assert.rejects(
    service.stream({ merchantId: "", format: "csv" }),
    /merchant_not_found/,
  );
});

test("ProductFeedService stops at maxPages guard to avoid runaway", async () => {
  const { repo, calls } = makeProductRepo(
    Array.from({ length: 100 }, () => ({
      products: [makeProduct("x")],
      total: 100,
      nextCursor: "always_more",
    })),
  );
  const service = new ProductFeedService(repo, makeMerchantRepo("Brand"));

  const result = await service.stream({
    merchantId: "mrc_1",
    format: "csv",
    maxPages: 3,
  });
  assert.equal(calls.length, 3, "should stop after maxPages");
  assert.equal(result.pagination.hasMore, true);
  assert.equal(result.pagination.nextCursor, "always_more");
});
