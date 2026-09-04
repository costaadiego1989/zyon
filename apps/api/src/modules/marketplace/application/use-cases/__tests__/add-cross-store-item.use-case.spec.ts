import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AddCrossStoreItemUseCase } from "../add-cross-store-item.use-case.js";
import { CommissionCalculatorService } from "../../../domain/services/commission-calculator.service.js";

describe("AddCrossStoreItemUseCase", () => {
  const commissionCalc = new CommissionCalculatorService();

  it("should throw when marketplace not enabled", async () => {
    const mockConfigRepo = {
      get: async () => ({ enabled: false } as any),
    };
    const mockProductRepo = { getById: async () => ({}) } as any;
    const mockOrderRepo = {} as any;

    const useCase = new AddCrossStoreItemUseCase(
      mockOrderRepo,
      mockConfigRepo as any,
      mockProductRepo,
      commissionCalc,
    );

    await assert.rejects(
      () =>
        useCase.execute({
          checkoutSessionId: "cs-1",
          hostMerchantId: "m1",
          sellerMerchantId: "m2",
          federatedProductId: "fp-1",
          quantity: 1,
          unitPriceCents: 1000,
        }),
      { message: "Marketplace not enabled for this merchant" },
    );
  });

  it("should throw when product not found", async () => {
    const mockConfigRepo = {
      get: async () => ({
        enabled: true,
        commissionRateBps: 1500,
        blockedMerchants: [],
      } as any),
    };
    const mockProductRepo = { getById: async () => undefined } as any;
    const mockOrderRepo = {} as any;

    const useCase = new AddCrossStoreItemUseCase(
      mockOrderRepo,
      mockConfigRepo as any,
      mockProductRepo,
      commissionCalc,
    );

    await assert.rejects(
      () =>
        useCase.execute({
          checkoutSessionId: "cs-1",
          hostMerchantId: "m1",
          sellerMerchantId: "m2",
          federatedProductId: "fp-1",
          quantity: 1,
          unitPriceCents: 1000,
        }),
      { message: "Product not found" },
    );
  });

  it("should throw when seller is blocked", async () => {
    const mockConfigRepo = {
      get: async () => ({
        enabled: true,
        commissionRateBps: 1500,
        blockedMerchants: ["m2"],
      } as any),
    };
    const mockProductRepo = {
      getById: async () => ({
        id: "fp-1",
        sourceMerchantId: "m3",
      }),
    } as any;
    const mockOrderRepo = {} as any;

    const useCase = new AddCrossStoreItemUseCase(
      mockOrderRepo,
      mockConfigRepo as any,
      mockProductRepo,
      commissionCalc,
    );

    await assert.rejects(
      () =>
        useCase.execute({
          checkoutSessionId: "cs-1",
          hostMerchantId: "m1",
          sellerMerchantId: "m2",
          federatedProductId: "fp-1",
          quantity: 1,
          unitPriceCents: 1000,
        }),
      { message: "Seller is blocked" },
    );
  });

  it("should create line item with commission", async () => {
    const mockConfigRepo = {
      get: async () => ({
        enabled: true,
        commissionRateBps: 1500,
        blockedMerchants: [],
      } as any),
    };
    const mockProductRepo = {
      getById: async () => ({
        id: "fp-1",
        sourceMerchantId: "m3",
      }),
    } as any;
    const created = {
      id: "li-1",
      commissionCents: 150,
      sellerNetCents: 850,
    };
    const mockOrderRepo = {
      create: async () => created,
    } as any;

    const useCase = new AddCrossStoreItemUseCase(
      mockOrderRepo,
      mockConfigRepo as any,
      mockProductRepo,
      commissionCalc,
    );

    const result = await useCase.execute({
      checkoutSessionId: "cs-1",
      hostMerchantId: "m1",
      sellerMerchantId: "m2",
      federatedProductId: "fp-1",
      quantity: 1,
      unitPriceCents: 1000,
    });

    assert.strictEqual(result.lineItem.id, "li-1");
  });
});
