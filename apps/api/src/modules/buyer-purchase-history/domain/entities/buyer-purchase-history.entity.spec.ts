import test from "node:test";
import assert from "node:assert/strict";
import { BuyerPurchaseHistoryEntity } from "./buyer-purchase-history.entity.js";

test("BuyerPurchaseHistoryEntity aggregates buyer merchant stats and compact safe context", () => {
  const history = BuyerPurchaseHistoryEntity.create({
    merchantId: "mrc_1",
    globalUserId: "usr_global_1"
  });

  const first = history.recordPurchase({
    merchantId: "mrc_1",
    orderId: "ord_1",
    globalUserId: "usr_global_1",
    currency: "BRL",
    totalAmount: 200,
    discountAmount: 0,
    completedAt: "2026-04-01T12:00:00.000Z",
    items: [
      {
        sku: "shoe-001",
        title: "Running Shoe",
        categoryId: "running-shoes",
        quantity: 1,
        unitPrice: 200,
        discountAmount: 0
      }
    ]
  });
  const second = first.recordPurchase({
    merchantId: "mrc_1",
    orderId: "ord_2",
    globalUserId: "usr_global_1",
    currency: "BRL",
    totalAmount: 100,
    discountAmount: 20,
    completedAt: "2026-04-20T12:00:00.000Z",
    items: [
      {
        sku: "sock-002",
        title: "Performance Sock",
        categoryId: "accessories",
        quantity: 2,
        unitPrice: 50,
        discountAmount: 20
      },
      {
        sku: "shoe-001",
        title: "Running Shoe",
        categoryId: "running-shoes",
        quantity: 1,
        unitPrice: 100,
        discountAmount: 0
      }
    ]
  });

  const stats = second.stats();
  const context = second.toSafeContext();

  assert.equal(stats.ordersCount, 2);
  assert.equal(stats.lifetimeValue, 300);
  assert.equal(stats.averageOrderValue, 150);
  assert.equal(stats.lastOrderAt, "2026-04-20T12:00:00.000Z");
  assert.deepEqual(stats.topCategories, ["running-shoes", "accessories"]);
  assert.deepEqual(stats.topSkus, ["shoe-001", "sock-002"]);
  assert.equal(stats.discountSensitivity, "medium");
  assert.equal(context.purchase_history.known_buyer, true);
  assert.equal(context.purchase_history.orders_count, 2);
  assert.deepEqual(context.purchase_history.recent_skus, ["sock-002", "shoe-001"]);
  assert.equal("email" in context.purchase_history, false);
});

test("BuyerPurchaseHistoryEntity records purchases idempotently and rejects cross-merchant facts", () => {
  const history = BuyerPurchaseHistoryEntity.create({
    merchantId: "mrc_1",
    merchantCustomerId: "cust_1"
  });
  const purchase = {
    merchantId: "mrc_1",
    orderId: "ord_1",
    merchantCustomerId: "cust_1",
    currency: "BRL" as const,
    totalAmount: 150,
    discountAmount: 15,
    completedAt: "2026-04-01T12:00:00.000Z",
    items: [{ sku: "sku_1", title: "Item", quantity: 1, unitPrice: 150, discountAmount: 15 }]
  };

  const once = history.recordPurchase(purchase);
  const twice = once.recordPurchase(purchase);

  assert.equal(twice.stats().ordersCount, 1);
  assert.throws(() => twice.recordPurchase({ ...purchase, merchantId: "mrc_2", orderId: "ord_2" }), /merchant_mismatch/);
});
