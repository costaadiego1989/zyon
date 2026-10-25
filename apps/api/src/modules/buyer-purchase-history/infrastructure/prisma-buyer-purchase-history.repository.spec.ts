import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { PrismaBuyerPurchaseHistoryRepository } from "./prisma-buyer-purchase-history.repository.js";

test("PrismaBuyerPurchaseHistoryRepository builds buyer context from an aggregate and a bounded recent window", async () => {
  const calls: { aggregate?: unknown; findMany?: unknown } = {};
  const prisma = {
    buyerPurchaseRecord: {
      aggregate(args: unknown) {
        calls.aggregate = args;
        return Promise.resolve({
          _count: { _all: 100_000 },
          _sum: { totalAmount: { toNumber: () => 12_345_678.9 } },
          _max: { completedAt: new Date("2026-09-06T10:00:00.000Z") }
        });
      },
      findMany(args: unknown) {
        calls.findMany = args;
        return Promise.resolve([
          {
            merchantId: "mrc_1",
            orderId: "ord_latest",
            globalUserId: "usr_1",
            merchantCustomerId: null,
            currency: "BRL",
            totalAmount: { toNumber: () => 120 },
            discountAmount: { toNumber: () => 10 },
            completedAt: new Date("2026-09-06T10:00:00.000Z"),
            items: [{ sku: "sku_latest", title: "Latest", quantity: 1, unitPrice: 120, discountAmount: 10 }]
          }
        ]);
      }
    },
    $transaction<T>(operations: readonly Promise<T>[]) {
      return Promise.all(operations);
    }
  } as unknown as PrismaClient;
  const repository = new PrismaBuyerPurchaseHistoryRepository(prisma);

  const context = await repository.getContext({ merchantId: "mrc_1", globalUserId: "usr_1" });

  assert.equal(context?.purchase_history.orders_count, 100_000);
  assert.equal(context?.purchase_history.lifetime_value, 12_345_678.9);
  assert.equal(context?.purchase_history.average_order_value, 123.46);
  assert.deepEqual(context?.purchase_history.recent_skus, ["sku_latest"]);
  assert.deepEqual(calls.aggregate, {
    where: { merchantId: "mrc_1", globalUserId: "usr_1" },
    _count: { _all: true },
    _sum: { totalAmount: true },
    _max: { completedAt: true }
  });
  assert.equal((calls.findMany as { take: number }).take, 100);
  assert.equal((calls.findMany as { orderBy: { completedAt: string } }).orderBy.completedAt, "desc");
  assert.ok((calls.findMany as { where: { completedAt: { gte: Date } } }).where.completedAt.gte instanceof Date);
});
