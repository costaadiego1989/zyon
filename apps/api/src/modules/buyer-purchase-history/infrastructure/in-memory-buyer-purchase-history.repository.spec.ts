import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryBuyerPurchaseHistoryRepository } from "./in-memory-buyer-purchase-history.repository.js";

test("InMemoryBuyerPurchaseHistoryRepository reads context by merchant and buyer identity", async () => {
  const repository = new InMemoryBuyerPurchaseHistoryRepository();
  await repository.recordPurchase({
    merchantId: "mrc_1",
    orderId: "ord_1",
    globalUserId: "usr_global_1",
    currency: "BRL",
    totalAmount: 99,
    discountAmount: 0,
    completedAt: "2026-04-01T12:00:00.000Z",
    items: [{ sku: "sku_1", title: "Item", quantity: 1, unitPrice: 99, discountAmount: 0 }]
  });

  const found = await repository.getContext({
    merchantId: "mrc_1",
    globalUserId: "usr_global_1"
  });
  const otherMerchant = await repository.getContext({
    merchantId: "mrc_2",
    globalUserId: "usr_global_1"
  });

  assert.equal(found?.purchase_history.orders_count, 1);
  assert.equal(otherMerchant, undefined);
});

test("InMemoryBuyerPurchaseHistoryRepository upserts purchases idempotently by merchant and order", async () => {
  const repository = new InMemoryBuyerPurchaseHistoryRepository();
  const purchase = {
    merchantId: "mrc_1",
    orderId: "ord_1",
    globalUserId: "usr_global_1",
    currency: "BRL" as const,
    totalAmount: 80,
    discountAmount: 10,
    completedAt: "2026-04-01T12:00:00.000Z",
    items: [{ sku: "sku_1", title: "Item", quantity: 1, unitPrice: 80, discountAmount: 10 }]
  };

  const first = await repository.recordPurchase(purchase);
  const second = await repository.recordPurchase(purchase);

  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(second.ordersCount, 1);
});
