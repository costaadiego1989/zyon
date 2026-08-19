import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SearchFederatedProductsUseCase } from "../search-federated-products.use-case.js";

describe("SearchFederatedProductsUseCase", () => {
  it("should return empty products when marketplace disabled", async () => {
    const mockConfigRepo = {
      get: async () => ({ enabled: false } as any),
    };
    const mockProductRepo = {} as any;
    const mockSearchService = {} as any;

    const useCase = new SearchFederatedProductsUseCase(
      mockProductRepo,
      mockConfigRepo as any,
      mockSearchService,
    );

    const result = await useCase.execute({
      hostMerchantId: "m1",
      query: "test",
    });

    assert.strictEqual(result.products.length, 0);
  });
});
