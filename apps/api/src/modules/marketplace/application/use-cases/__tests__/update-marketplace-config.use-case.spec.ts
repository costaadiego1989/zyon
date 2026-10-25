import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { UpdateMarketplaceConfigUseCase } from "../update-marketplace-config.use-case.js";

describe("UpdateMarketplaceConfigUseCase", () => {
  it("should reject commission_rate_bps below 100", async () => {
    const mockConfigRepo = { upsert: async () => ({}) } as any;
    const useCase = new UpdateMarketplaceConfigUseCase(mockConfigRepo);

    await assert.rejects(
      () =>
        useCase.execute({
          merchantId: "m1",
          commissionRateBps: 50,
        }),
      { message: "commission_rate_bps must be between 100 and 5000 (1%-50%)" },
    );
  });

  it("should reject commission_rate_bps above 5000", async () => {
    const mockConfigRepo = { upsert: async () => ({}) } as any;
    const useCase = new UpdateMarketplaceConfigUseCase(mockConfigRepo);

    await assert.rejects(
      () =>
        useCase.execute({
          merchantId: "m1",
          commissionRateBps: 6000,
        }),
      { message: "commission_rate_bps must be between 100 and 5000 (1%-50%)" },
    );
  });

  it("should reject return_window_days out of range", async () => {
    const mockConfigRepo = { upsert: async () => ({}) } as any;
    const useCase = new UpdateMarketplaceConfigUseCase(mockConfigRepo);

    await assert.rejects(
      () =>
        useCase.execute({
          merchantId: "m1",
          returnWindowDays: 0,
        }),
      { message: "return_window_days must be between 1 and 30" },
    );
  });

  it("should reject payout_delay_days out of range", async () => {
    const mockConfigRepo = { upsert: async () => ({}) } as any;
    const useCase = new UpdateMarketplaceConfigUseCase(mockConfigRepo);

    await assert.rejects(
      () =>
        useCase.execute({
          merchantId: "m1",
          payoutDelayDays: 31,
        }),
      { message: "payout_delay_days must be between 1 and 30" },
    );
  });

  it("should reject chargeback_window_days below 7", async () => {
    const mockConfigRepo = { upsert: async () => ({}) } as any;
    const useCase = new UpdateMarketplaceConfigUseCase(mockConfigRepo);

    await assert.rejects(
      () =>
        useCase.execute({
          merchantId: "m1",
          chargebackWindowDays: 3,
        }),
      { message: "chargeback_window_days must be between 7 and 30" },
    );
  });

  it("should upsert valid config", async () => {
    const mockConfigRepo = {
      upsert: async (input: any) => ({
        id: "cfg-1",
        merchantId: input.merchantId,
        enabled: true,
        commissionRateBps: 2000,
        returnWindowDays: 7,
        payoutDelayDays: 14,
        chargebackWindowDays: 30,
        allowedCategories: [],
        blockedMerchants: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    } as any;
    const useCase = new UpdateMarketplaceConfigUseCase(mockConfigRepo);

    const result = await useCase.execute({
      merchantId: "m1",
      enabled: true,
      commissionRateBps: 2000,
    });

    assert.strictEqual(result.config.commissionRateBps, 2000);
  });
});
