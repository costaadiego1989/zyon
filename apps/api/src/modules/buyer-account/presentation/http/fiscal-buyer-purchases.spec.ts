import assert from "node:assert/strict";
import test from "node:test";
import { BuyerAccountController } from "./buyer-account.controller.js";
import { GetBuyerPurchasesUseCase } from "../../application/use-cases/get-buyer-purchases.use-case.js";
import type { PrismaClient } from "@prisma/client";
test("FISCAL-41 purchase navigation exposes the original commercial merchant and external order distinct from purchase ID", async () => {
  const row = {
    id: "purchase-row",
    orderId: "commercial-external-order",
    merchantId: "original-host",
    merchantName: "Loja original",
    trackingEvents: [],
    totalAmount: 100,
    discountAmount: 0,
    currency: "BRL",
    completedAt: new Date("2026-11-16T12:00:00Z"),
    items: [],
  };
  let actor;
  const result = await BuyerAccountController.prototype.getPurchaseHistory.call(
    {
      getPurchases: {
        execute: async (input) => {
          actor = input;
          return { records: [row], nextCursor: "next-owned-page" };
        },
      },
    } as any,
    { user: { globalUserId: "trusted-buyer", email: "buyer@example.invalid" } },
    "original-host",
    undefined,
    undefined,
    "10"
  );
  assert.equal(result.items[0].merchant_id, "original-host");
  assert.equal(result.items[0].order_id, "commercial-external-order");
  assert.equal(result.items[0].id, "purchase-row");
  assert.equal(result.next_cursor, "next-owned-page");
  assert.deepEqual(actor, {
    globalUserId: "trusted-buyer",
    merchantId: "original-host",
    dateFrom: undefined,
    dateTo: undefined,
    limit: 10,
    cursor: undefined,
  });
});

test("FISCAL-41 original purchase pagination round trips ISO time and compound purchase ID without changing buyer merchant scope", async () => {
  const at = new Date("2026-11-16T12:34:56.789Z"),
    id = "original-host:commercial/order";
  let call = 0;
  const row = {
    id,
    merchantId: "original-host",
    orderId: "commercial/order",
    totalAmount: 100,
    discountAmount: 0,
    currency: "BRL",
    completedAt: at,
    items: [],
  };
  const prisma = {
    buyerPurchaseRecord: {
      findMany: async (query: any) => {
        assert.equal(query.where.globalUserId, "trusted-buyer");
        assert.equal(query.where.merchantId, "original-host");
        assert.equal(query.take, 2);
        assert.deepEqual(query.orderBy, [
          { completedAt: "desc" },
          { id: "desc" },
        ]);
        if (call++ === 0) return [row, { ...row, id: "older" }];
        assert.equal(
          Number.isFinite(query.where.OR[0].completedAt.lt.getTime()),
          true,
          "the original ISO cursor must retain a valid timestamp"
        );
        assert.deepEqual(query.where.OR, [
          { completedAt: { lt: at } },
          { completedAt: at, id: { lt: id } },
        ]);
        return [];
      },
    },
    merchant: { findMany: async () => [] },
    completedOrder: { findMany: async () => [] },
  } as unknown as PrismaClient;
  const useCase = new GetBuyerPurchasesUseCase(prisma),
    scope = {
      globalUserId: "trusted-buyer",
      merchantId: "original-host",
      limit: 1,
    };
  const first = await useCase.execute(scope);
  assert.ok(first.nextCursor);
  assert.equal(first.records[0].orderId, "commercial/order");
  assert.deepEqual(
    await useCase.execute({ ...scope, cursor: first.nextCursor }),
    { records: [], nextCursor: null }
  );
  assert.equal(call, 2);
});
