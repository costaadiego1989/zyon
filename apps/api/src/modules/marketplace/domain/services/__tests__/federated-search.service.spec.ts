import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FederatedSearchService,
  type FederatedSearchParams,
  type FederatedSearchRepositoryPort,
  type RawFederatedProduct,
} from "../federated-search.service.js";

class MockSearchRepository implements FederatedSearchRepositoryPort {
  private products: RawFederatedProduct[] = [];

  setProducts(products: RawFederatedProduct[]) {
    this.products = products;
  }

  async searchByQuery(
    _query: string,
    category: string | undefined,
    _limit: number
  ): Promise<RawFederatedProduct[]> {
    let results = [...this.products];

    if (category) {
      results = results.filter((p) => p.category === category);
    }

    results = results.filter((p) => p.stockAvailable);

    return results.sort((a, b) => b.tsRank - a.tsRank);
  }
}

function createProduct(overrides: Partial<RawFederatedProduct> = {}): RawFederatedProduct {
  return {
    id: "fp-1",
    sourceMerchantId: "seller-1",
    sourceProductId: "prod-1",
    sellerName: "Seller One",
    name: "Test Product",
    description: "A test product",
    category: "roupas",
    priceCents: 10000,
    currency: "BRL",
    commissionRateBps: 1000,
    stockAvailable: true,
    imageUrl: "https://example.com/img.png",
    tsRank: 80,
    ...overrides,
  };
}

describe("FederatedSearchService", () => {
  const repo = new MockSearchRepository();
  const service = new FederatedSearchService(repo);

  describe("validation", () => {
    it("throws on empty query", async () => {
      const params: FederatedSearchParams = {
        hostMerchantId: "host-1",
        query: "",
        limit: 5,
        excludeMerchants: [],
      };

      await assert.rejects(() => service.search(params), {
        message: "Query must not be empty",
      });
    });

    it("throws on whitespace-only query", async () => {
      const params: FederatedSearchParams = {
        hostMerchantId: "host-1",
        query: "   ",
        limit: 5,
        excludeMerchants: [],
      };

      await assert.rejects(() => service.search(params), {
        message: "Query must not be empty",
      });
    });

    it("throws on query exceeding 200 characters", async () => {
      const params: FederatedSearchParams = {
        hostMerchantId: "host-1",
        query: "a".repeat(201),
        limit: 5,
        excludeMerchants: [],
      };

      await assert.rejects(() => service.search(params), {
        message: "Query must be at most 200 characters",
      });
    });

    it("throws on limit below 1", async () => {
      const params: FederatedSearchParams = {
        hostMerchantId: "host-1",
        query: "calça",
        limit: 0,
        excludeMerchants: [],
      };

      await assert.rejects(() => service.search(params), {
        message: "Limit must be between 1 and 20",
      });
    });

    it("throws on limit above 20", async () => {
      const params: FederatedSearchParams = {
        hostMerchantId: "host-1",
        query: "calça",
        limit: 21,
        excludeMerchants: [],
      };

      await assert.rejects(() => service.search(params), {
        message: "Limit must be between 1 and 20",
      });
    });

    it("throws on empty hostMerchantId", async () => {
      const params: FederatedSearchParams = {
        hostMerchantId: "",
        query: "calça",
        limit: 5,
        excludeMerchants: [],
      };

      await assert.rejects(() => service.search(params), {
        message: "Host merchant ID is required",
      });
    });
  });

  describe("filtering", () => {
    it("excludes host merchant products", async () => {
      repo.setProducts([
        createProduct({ id: "fp-1", sourceMerchantId: "host-1", tsRank: 90 }),
        createProduct({ id: "fp-2", sourceMerchantId: "seller-2", tsRank: 80 }),
      ]);

      const results = await service.search({
        hostMerchantId: "host-1",
        query: "calça",
        limit: 5,
        excludeMerchants: [],
      });

      assert.equal(results.length, 1);
      assert.equal(results[0].sellerMerchantId, "seller-2");
    });

    it("excludes merchants from excludeMerchants list", async () => {
      repo.setProducts([
        createProduct({ id: "fp-1", sourceMerchantId: "seller-1", tsRank: 90 }),
        createProduct({ id: "fp-2", sourceMerchantId: "seller-2", tsRank: 80 }),
        createProduct({ id: "fp-3", sourceMerchantId: "seller-3", tsRank: 70 }),
      ]);

      const results = await service.search({
        hostMerchantId: "host-1",
        query: "calça",
        limit: 5,
        excludeMerchants: ["seller-1", "seller-3"],
      });

      assert.equal(results.length, 1);
      assert.equal(results[0].sellerMerchantId, "seller-2");
    });

    it("filters by category when provided", async () => {
      repo.setProducts([
        createProduct({ id: "fp-1", sourceMerchantId: "seller-1", category: "roupas", tsRank: 90 }),
        createProduct({ id: "fp-2", sourceMerchantId: "seller-2", category: "sapatos", tsRank: 80 }),
      ]);

      const results = await service.search({
        hostMerchantId: "host-1",
        query: "produto",
        category: "roupas",
        limit: 5,
        excludeMerchants: [],
      });

      assert.equal(results.length, 1);
      assert.equal(results[0].category, "roupas");
    });

    it("only returns stock_available products", async () => {
      repo.setProducts([
        createProduct({ id: "fp-1", sourceMerchantId: "seller-1", stockAvailable: false, tsRank: 90 }),
        createProduct({ id: "fp-2", sourceMerchantId: "seller-2", stockAvailable: true, tsRank: 80 }),
      ]);

      const results = await service.search({
        hostMerchantId: "host-1",
        query: "produto",
        limit: 5,
        excludeMerchants: [],
      });

      assert.equal(results.length, 1);
      assert.equal(results[0].id, "fp-2");
    });
  });

  describe("ranking and limiting", () => {
    it("returns results ordered by relevance score (descending)", async () => {
      repo.setProducts([
        createProduct({ id: "fp-1", sourceMerchantId: "seller-1", tsRank: 50 }),
        createProduct({ id: "fp-2", sourceMerchantId: "seller-2", tsRank: 90 }),
        createProduct({ id: "fp-3", sourceMerchantId: "seller-3", tsRank: 70 }),
      ]);

      const results = await service.search({
        hostMerchantId: "host-1",
        query: "produto",
        limit: 5,
        excludeMerchants: [],
      });

      assert.equal(results[0].relevanceScore, 90);
      assert.equal(results[1].relevanceScore, 70);
      assert.equal(results[2].relevanceScore, 50);
    });

    it("respects limit parameter", async () => {
      repo.setProducts([
        createProduct({ id: "fp-1", sourceMerchantId: "seller-1", tsRank: 90 }),
        createProduct({ id: "fp-2", sourceMerchantId: "seller-2", tsRank: 80 }),
        createProduct({ id: "fp-3", sourceMerchantId: "seller-3", tsRank: 70 }),
      ]);

      const results = await service.search({
        hostMerchantId: "host-1",
        query: "produto",
        limit: 2,
        excludeMerchants: [],
      });

      assert.equal(results.length, 2);
    });

    it("caps relevance score at 100", async () => {
      repo.setProducts([
        createProduct({ id: "fp-1", sourceMerchantId: "seller-1", tsRank: 150 }),
      ]);

      const results = await service.search({
        hostMerchantId: "host-1",
        query: "produto",
        limit: 5,
        excludeMerchants: [],
      });

      assert.equal(results[0].relevanceScore, 100);
    });
  });

  describe("mapping", () => {
    it("correctly maps raw product to result", async () => {
      const raw = createProduct({
        id: "fp-99",
        sourceMerchantId: "seller-x",
        sourceProductId: "prod-x",
        sellerName: "Loja X",
        name: "Calça Premium",
        description: "Descrição da calça",
        category: "roupas",
        priceCents: 29900,
        currency: "BRL",
        commissionRateBps: 1500,
        stockAvailable: true,
        imageUrl: "https://example.com/calca.png",
        tsRank: 92,
      });

      repo.setProducts([raw]);

      const results = await service.search({
        hostMerchantId: "host-1",
        query: "calça",
        limit: 5,
        excludeMerchants: [],
      });

      assert.equal(results.length, 1);
      const r = results[0];
      assert.equal(r.id, "fp-99");
      assert.equal(r.sourceProductId, "prod-x");
      assert.equal(r.sellerMerchantId, "seller-x");
      assert.equal(r.sellerName, "Loja X");
      assert.equal(r.name, "Calça Premium");
      assert.equal(r.description, "Descrição da calça");
      assert.equal(r.category, "roupas");
      assert.equal(r.priceInCents, 29900);
      assert.equal(r.currency, "BRL");
      assert.equal(r.commissionRateBps, 1500);
      assert.equal(r.stockAvailable, true);
      assert.equal(r.imageUrl, "https://example.com/calca.png");
      assert.equal(r.relevanceScore, 92);
    });
  });
});
