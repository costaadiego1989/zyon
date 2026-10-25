import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SyncMerchantProductsUseCase } from "../sync-merchant-products.use-case.js";

describe("SyncMerchantProductsUseCase", () => {
  it("should sync products and return count", async () => {
    const upsertCalls: any[] = [];
    const mockProductRepo = {
      upsert: async (input: any) => {
        upsertCalls.push(input);
        return { id: `fp-${upsertCalls.length}` };
      },
    } as any;

    const useCase = new SyncMerchantProductsUseCase(mockProductRepo);

    const result = await useCase.execute({
      sourceMerchantId: "m1",
      products: [
        {
          sourceProductId: "sp-1",
          name: "Product 1",
          priceCents: 1000,
        },
        {
          sourceProductId: "sp-2",
          name: "Product 2",
          priceCents: 2000,
          category: "electronics",
        },
      ],
    });

    assert.strictEqual(result.synced, 2);
    assert.strictEqual(upsertCalls.length, 2);
  });
});
