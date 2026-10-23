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
        orderId: "provider_order_1",
        sellerMerchantId: "m2",
        fulfillmentStatus: "pending",
        sellerNetCents: 1000,
        commissionCents: 300,
        createdAt: startOfMonth,
      },
      {
        id: "li-2",
        orderId: "provider_order_2",
        sellerMerchantId: "m2",
        fulfillmentStatus: "shipped",
        sellerNetCents: 2000,
        commissionCents: 500,
        createdAt: startOfMonth,
      },
      {
        id: "li-3",
        orderId: "provider_order_3",
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
        orderId: "provider_order_1",
        sellerMerchantId: "m2",
        fulfillmentStatus: "shipped",
        sellerNetCents: 1000,
        commissionCents: 100,
        createdAt: startOfMonth,
      },
      {
        id: "li-2",
        orderId: "provider_order_2",
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

  it("excludes unpurchased carts and reversed sales, using purchase dates and remaining debt", async () => {
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const orders = [
      { id: "draft", fulfillmentStatus: "pending", sellerNetCents: 9000, commissionCents: 1000, createdAt: thisMonth },
      { id: "purchased", orderId: "order_good", fulfillmentStatus: "delivered", sellerNetCents: 800, commissionCents: 200, createdAt: previousMonth, purchasedAt: thisMonth },
      { id: "old_purchase", orderId: "order_old", fulfillmentStatus: "pending", sellerNetCents: 400, commissionCents: 100, createdAt: thisMonth, purchasedAt: previousMonth },
      ...["return_cancelled", "chargeback_cancelled", "chargeback_debt"].map(status => ({ id: status, orderId: `order_${status}`,
        fulfillmentStatus: "shipped", sellerNetCents: 10_000, commissionCents: 2000, createdAt: thisMonth })),
    ];
    const requestedTenants: string[] = [];
    const useCase = new GetSellerStatsUseCase(
      { findBySellerMerchantId: async (merchantId: string) => { requestedTenants.push(merchantId); return orders; } } as never,
      { findBySellerMerchantId: async (merchantId: string) => { requestedTenants.push(merchantId); return [
        ...["return_cancelled", "chargeback_cancelled", "chargeback_debt"].map(status => ({ lineItemId: status, status })),
      ]; } } as never,
      { findOutstandingBySellerMerchantId: async (merchantId: string) => { requestedTenants.push(merchantId); return [
        { amountCents: 1000, outstandingAmountCents: 250 }, { amountCents: 100, outstandingAmountCents: 0 }, { amountCents: 50 },
      ]; } } as never,
    );
    assert.deepEqual(await useCase.execute({ sellerMerchantId: "seller_scope" }), {
      pendingOrders: 1, monthlyRevenueCents: 800, monthlyCommissionCents: 200,
      itemsShipped: 1, totalItems: 2, fulfillmentRate: 0.5, outstandingDebtCents: 300,
    });
    assert.deepEqual(requestedTenants, ["seller_scope", "seller_scope", "seller_scope"]);
  });
});
