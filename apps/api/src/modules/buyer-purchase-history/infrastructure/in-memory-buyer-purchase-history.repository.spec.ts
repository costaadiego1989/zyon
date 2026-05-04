import test from "node:test";
import assert from "node:assert/strict";
import { BuyerPurchaseHistoryEntity } from "../domain/entities/buyer-purchase-history.entity.js";
import { InMemoryBuyerPurchaseHistoryRepository } from "./in-memory-buyer-purchase-history.repository.js";

test("InMemoryBuyerPurchaseHistoryRepository saves and reads history by merchant and buyer identity", async () => {
  const repository = new InMemoryBuyerPurchaseHistoryRepository();
  const history = BuyerPurchaseHistoryEntity.create({
    merchantId: "mrc_1",
    globalUserId: "usr_global_1"
  }).recordPurchase({
    merchantId: "mrc_1",
    orderId: "ord_1",
    globalUserId: "usr_global_1",
    currency: "BRL",
    totalAmount: 99,
    discountAmount: 0,
    completedAt: "2026-04-01T12:00:00.000Z",
    items: [{ sku: "sku_1", title: "Item", quantity: 1, unitPrice: 99, discountAmount: 0 }]
  });

  await repository.save(history);

  const found = await repository.getByBuyer({
    merchantId: "mrc_1",
    globalUserId: "usr_global_1"
  });
  const otherMerchant = await repository.getByBuyer({
    merchantId: "mrc_2",
    globalUserId: "usr_global_1"
  });

  assert.equal(found?.stats().ordersCount, 1);
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
  assert.equal(second.history.stats().ordersCount, 1);
});
