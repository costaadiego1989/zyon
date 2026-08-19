import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GetSellerStatsUseCase } from "../get-seller-stats.use-case.js";

describe("GetSellerStatsUseCase", () => {
  it("should calculate basic stats correctly", async () => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const beforeMonth = new Date(startOfMonth.getTime() - 1000);

    const orders = [
      {
        id: "li-1",
        sellerMerchantId: "m2",
        fulfillmentStatus: "pending",
        sellerNetCents: 1000,
        commissionCents: 300,
        createdAt: startOfMonth,
      },
      {
        id: "li-2",
        sellerMerchantId: "m2",
        fulfillmentStatus: "shipped",
        sellerNetCents: 2000,
        commissionCents: 500,
        createdAt: startOfMonth,
      },
      {
        id: "li-3",
        sellerMerchantId: "m2",
        fulfillmentStatus: "shipped",
        sellerNetCents: 1500,
        commissionCents: 400,
        createdAt: beforeMonth,
      },
    ];

    const mockOrderRepo = {
      findBySellerMerchantId: async () => orders,
    } as any;
    const mockSettlementRepo = {
      findBySellerMerchantId: async () => [],
    } as any;
    const mockDebtRepo = {
      findOutstandingBySellerMerchantId: async () => [],
    } as any;

    const useCase = new GetSellerStatsUseCase(
      mockOrderRepo,
      mockSettlementRepo,
      mockDebtRepo,
    );

    const result = await useCase.execute({ sellerMerchantId: "m2" });

    // Monthly: only li-1 and li-2
    assert.strictEqual(result.pendingOrders, 1);
    assert.strictEqual(result.monthlyRevenueCents, 3000); // 1000 + 2000
    assert.strictEqual(result.monthlyCommissionCents, 800); // 300 + 500
    assert.strictEqual(result.itemsShipped, 2);
    assert.strictEqual(result.totalItems, 3);
    assert.strictEqual(result.fulfillmentRate, 2 / 3);
    assert.strictEqual(result.outstandingDebtCents, 0);
  });

  it("should calculate fulfillment rate with zero orders", async () => {
    const mockOrderRepo = {
      findBySellerMerchantId: async () => [],
    } as any;
    const mockSettlementRepo = {
      findBySellerMerchantId: async () => [],
    } as any;
    const mockDebtRepo = {
      findOutstandingBySellerMerchantId: async () => [],
    } as any;

    const useCase = new GetSellerStatsUseCase(
      mockOrderRepo,
      mockSettlementRepo,
      mockDebtRepo,
    );

    const result = await useCase.execute({ sellerMerchantId: "m2" });

    assert.strictEqual(result.totalItems, 0);
    assert.strictEqual(result.itemsShipped, 0);
    assert.strictEqual(result.fulfillmentRate, 0);
  });

  it("should sum outstanding debts correctly", async () => {
    const mockOrderRepo = {
      findBySellerMerchantId: async () => [],
    } as any;
    const mockSettlementRepo = {
      findBySellerMerchantId: async () => [],
    } as any;
    const debts = [
      {
        id: "d-1",
        amountCents: 500,
        status: "outstanding",
      },
      {
        id: "d-2",
        amountCents: 300,
        status: "outstanding",
      },
    ];
    const mockDebtRepo = {
      findOutstandingBySellerMerchantId: async () => debts,
    } as any;

    const useCase = new GetSellerStatsUseCase(
      mockOrderRepo,
      mockSettlementRepo,
      mockDebtRepo,
    );

    const result = await useCase.execute({ sellerMerchantId: "m2" });

    assert.strictEqual(result.outstandingDebtCents, 800);
  });

  it("should only count monthly items correctly", async () => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const oneMonthAgo = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const orders = [
      {
        id: "li-1",
        sellerMerchantId: "m2",
        fulfillmentStatus: "shipped",
        sellerNetCents: 1000,
        commissionCents: 100,
        createdAt: startOfMonth,
      },
      {
        id: "li-2",
        sellerMerchantId: "m2",
        fulfillmentStatus: "pending",
        sellerNetCents: 500,
        commissionCents: 50,
        createdAt: oneMonthAgo,
      },
    ];

    const mockOrderRepo = {
      findBySellerMerchantId: async () => orders,
    } as any;
    const mockSettlementRepo = {
      findBySellerMerchantId: async () => [],
    } as any;
    const mockDebtRepo = {
      findOutstandingBySellerMerchantId: async () => [],
    } as any;

    const useCase = new GetSellerStatsUseCase(
      mockOrderRepo,
      mockSettlementRepo,
      mockDebtRepo,
    );

    const result = await useCase.execute({ sellerMerchantId: "m2" });

    // Monthly counts only current month
    assert.strictEqual(result.monthlyRevenueCents, 1000);
    assert.strictEqual(result.monthlyCommissionCents, 100);
    // But pending and total include all
    assert.strictEqual(result.pendingOrders, 1);
    assert.strictEqual(result.totalItems, 2);
  });
});
