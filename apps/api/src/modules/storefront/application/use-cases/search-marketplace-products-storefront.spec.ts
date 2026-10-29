import test from "node:test";
import assert from "node:assert/strict";
import { SearchMarketplaceProductsStorefrontUseCase } from "./search-marketplace-products-storefront.use-case.js";
import { SearchFederatedProductsUseCase } from "../../../marketplace/application/use-cases/search-federated-products.use-case.js";

test("storefront limits always respect the federated search contract", async () => {
  const calls: number[] = [];
  const useCase = new SearchMarketplaceProductsStorefrontUseCase({ execute: async ({ limit }: any) => {
    assert.ok(Number.isInteger(limit) && limit >= 1 && limit <= 20);
    calls.push(limit); return { products: [] };
  } } as any, { merchant: { findMany: async () => [] } } as any);
  for (const limit of [undefined, 1, 10, 11, 20, 100, -1, NaN, 1.5]) {
    await useCase.execute({ merchantId: "host", query: "produto", limit });
  }
  assert.equal(calls.length, 9);
});

test("a missing marketplace configuration cannot activate federated search", async () => {
  const useCase = new SearchFederatedProductsUseCase({} as any, { get: async () => undefined } as any,
    { search: async () => { assert.fail("must not search"); } } as any, {} as any);
  assert.deepEqual(await useCase.execute({ hostMerchantId: "unconfigured", query: "produto" }), { products: [] });
});
