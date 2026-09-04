import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GetSellerOrdersUseCase } from "../get-seller-orders.use-case.js";

describe("GetSellerOrdersUseCase", () => {
  it("should return seller orders", async () => {
    const items = [
      { id: "li-1", sellerMerchantId: "m2" },
      { id: "li-2", sellerMerchantId: "m2" },
    ];
    const mockOrderRepo = {
      findBySellerMerchantId: async () => items,
    } as any;

    const useCase = new GetSellerOrdersUseCase(mockOrderRepo);

    const result = await useCase.execute({
      sellerMerchantId: "m2",
    });

    assert.strictEqual(result.orders.length, 2);
  });
});
