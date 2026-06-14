import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { GetBuyerSummaryUseCase } from "./get-buyer-summary.use-case.js";
import type { BuyerAccountRepository } from "../../domain/ports/buyer-account-repository.port.js";
import type { BuyerPurchaseHistoryRepository } from "../../../buyer-purchase-history/domain/ports/buyer-purchase-history-repository.port.js";

const originalCheckoutRepository = process.env.CHECKOUT_REPOSITORY;

test.after(() => {
  if (originalCheckoutRepository === undefined) {
    delete process.env.CHECKOUT_REPOSITORY;
  } else {
    process.env.CHECKOUT_REPOSITORY = originalCheckoutRepository;
  }
});

test("GetBuyerSummaryUseCase uses in-memory purchase history when CHECKOUT_REPOSITORY=in-memory", async () => {
  process.env.CHECKOUT_REPOSITORY = "in-memory";

  const repo = {
    findByGlobalUserId: async () => ({
      globalUserId: "guser_1",
      email: "buyer@test.com",
      displayName: "Buyer",
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    findAgentByGlobalUserId: async () => null,
  } as unknown as BuyerAccountRepository;

  const prisma = {
    buyerPurchaseRecord: {
      findMany: async () => {
        throw new Error("should not query prisma in in-memory mode");
      },
    },
    merchant: {
      findMany: async () => {
        throw new Error("should not query prisma merchants in in-memory mode");
      },
    },
  } as unknown as PrismaClient;

  const purchaseHistory = {
    listPurchasesForGlobalUser: async () => [
      {
        merchantId: "mrc_1",
        orderId: "order_1",
        globalUserId: "guser_1",
        currency: "BRL",
        totalAmount: 100,
        discountAmount: 10,
        completedAt: "2026-05-01T00:00:00.000Z",
        items: [],
      },
      {
        merchantId: "mrc_1",
        orderId: "order_2",
        globalUserId: "guser_1",
        currency: "BRL",
        totalAmount: 50,
        discountAmount: 5,
        completedAt: "2026-05-02T00:00:00.000Z",
        items: [],
      },
    ],
  } as unknown as BuyerPurchaseHistoryRepository & {
    listPurchasesForGlobalUser: (globalUserId: string) => Promise<unknown[]>;
  };

  const summary = await new GetBuyerSummaryUseCase(repo, prisma, purchaseHistory).execute("guser_1");

  assert.equal(summary.stats.totalOrders, 2);
  assert.equal(summary.stats.totalSpent, 150);
  assert.equal(summary.stats.totalSaved, 15);
  assert.deepEqual(summary.stats.topMerchants, [
    { merchantId: "mrc_1", merchantName: "mrc_1", orderCount: 2 },
  ]);
});
