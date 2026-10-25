import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { GetBuyerLoyaltyUseCase } from "./get-buyer-loyalty.use-case.js";

test("GetBuyerLoyaltyUseCase returns zeros/empty when no data exists", async () => {
  const prisma = {
    buyerGlobalProfile: {
      findUnique: async () => null,
    },
    buyerLoyaltyTracker: {
      findMany: async () => [],
    },
  } as unknown as PrismaClient;

  const result = await new GetBuyerLoyaltyUseCase(prisma).execute("guser_1");

  assert.equal(result.totalOrders, 0);
  assert.equal(result.totalSpentCents, 0);
  assert.equal(result.avgOrderValueCents, 0);
  assert.deepEqual(result.topCategories, []);
  assert.deepEqual(result.preferredBrands, []);
  assert.equal(result.discountSensitivity, "unknown");
  assert.equal(result.lastPurchaseAt, null);
});

test("GetBuyerLoyaltyUseCase uses global profile when available", async () => {
  const lastPurchaseAt = new Date("2026-05-20T12:00:00.000Z");
  const prisma = {
    buyerGlobalProfile: {
      findUnique: async () => ({
        globalUserId: "guser_1",
        totalOrders: 5,
        avgOrderValueCents: 10000,
        topCategories: ["electronics", "books"],
        preferredBrands: ["brand-a", "brand-b"],
        discountSensitivity: "high",
        lastPurchaseAt,
        recentSkus: [],
        updatedAt: new Date(),
      }),
    },
    buyerLoyaltyTracker: {
      findMany: async () => [],
    },
  } as unknown as PrismaClient;

  const result = await new GetBuyerLoyaltyUseCase(prisma).execute("guser_1");

  assert.equal(result.totalOrders, 5);
  assert.equal(result.avgOrderValueCents, 10000);
  assert.deepEqual(result.topCategories, ["electronics", "books"]);
  assert.deepEqual(result.preferredBrands, ["brand-a", "brand-b"]);
  assert.equal(result.discountSensitivity, "high");
  assert.deepEqual(result.lastPurchaseAt, lastPurchaseAt);
});

test("GetBuyerLoyaltyUseCase aggregates loyalty trackers across merchants", async () => {
  const date1 = new Date("2026-05-15T12:00:00.000Z");
  const date2 = new Date("2026-05-20T12:00:00.000Z");

  const prisma = {
    buyerGlobalProfile: {
      findUnique: async () => null,
    },
    buyerLoyaltyTracker: {
      findMany: async () => [
        {
          id: "tracker_1",
          merchantId: "mrc_1",
          buyerId: "guser_1",
          purchaseCount: 3,
          totalSpentCents: 50000,
          lastPurchaseAt: date1,
          lastWinBackAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "tracker_2",
          merchantId: "mrc_2",
          buyerId: "guser_1",
          purchaseCount: 2,
          totalSpentCents: 30000,
          lastPurchaseAt: date2,
          lastWinBackAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    },
  } as unknown as PrismaClient;

  const result = await new GetBuyerLoyaltyUseCase(prisma).execute("guser_1");

  assert.equal(result.totalOrders, 5);
  assert.equal(result.totalSpentCents, 80000);
  assert.equal(result.avgOrderValueCents, 16000); // 80000 / 5
  assert.deepEqual(result.lastPurchaseAt, date2); // Most recent
});
