import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { UpdateMarketplaceFulfillmentUseCase } from "../update-marketplace-fulfillment.use-case.js";

const pendingItem = {
  id: "line-1",
  sellerMerchantId: "seller-1",
  fulfillmentStatus: "pending",
  fulfillmentReference: null,
};

describe("UpdateMarketplaceFulfillmentUseCase", () => {
  it("ships an owned pending item with a tracking reference", async () => {
    const updateFulfillment = async (input: any) => ({
      ...pendingItem,
      fulfillmentStatus: input.status,
      fulfillmentReference: input.fulfillmentReference,
    });
    const useCase = new UpdateMarketplaceFulfillmentUseCase({
      findByIdForSeller: async () => pendingItem,
      updateFulfillment,
    } as any);

    const result = await useCase.execute({
      lineItemId: "line-1",
      sellerMerchantId: "seller-1",
      action: "ship",
      trackingNumber: " BR123 ",
    });

    assert.equal(result.fulfillmentStatus, "shipped");
    assert.equal(result.fulfillmentReference, "BR123");
  });

  it("does not expose or transition an item outside the seller tenant", async () => {
    const useCase = new UpdateMarketplaceFulfillmentUseCase({
      findByIdForSeller: async () => undefined,
    } as any);

    await assert.rejects(
      () => useCase.execute({ lineItemId: "foreign", sellerMerchantId: "seller-1", action: "ship", trackingNumber: "BR123" }),
      NotFoundException,
    );
  });

  it("rejects skipping shipped before delivered", async () => {
    const useCase = new UpdateMarketplaceFulfillmentUseCase({
      findByIdForSeller: async () => pendingItem,
    } as any);

    await assert.rejects(
      () => useCase.execute({ lineItemId: "line-1", sellerMerchantId: "seller-1", action: "deliver" }),
      ConflictException,
    );
  });

  it("reports a conflicting concurrent transition", async () => {
    const useCase = new UpdateMarketplaceFulfillmentUseCase({
      findByIdForSeller: async () => pendingItem,
      updateFulfillment: async () => undefined,
    } as any);

    await assert.rejects(
      () => useCase.execute({ lineItemId: "line-1", sellerMerchantId: "seller-1", action: "ship", trackingNumber: "BR123" }),
      ConflictException,
    );
  });
});
