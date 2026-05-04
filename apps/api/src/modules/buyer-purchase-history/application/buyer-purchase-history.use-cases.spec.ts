import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryBuyerPurchaseHistoryRepository } from "../infrastructure/in-memory-buyer-purchase-history.repository.js";
import {
  GetBuyerPurchaseContextUseCase,
  RecordCompletedPurchaseUseCase
} from "./buyer-purchase-history.use-cases.js";
import type {
  PurchaseHistoryMeteringEvent,
  PurchaseHistoryMeteringPort
} from "../domain/ports/purchase-history-metering.port.js";

class RecordingMeteringPort implements PurchaseHistoryMeteringPort {
  public events: PurchaseHistoryMeteringEvent[] = [];

  async record(event: PurchaseHistoryMeteringEvent): Promise<void> {
    this.events.push(event);
  }
}

test("buyer purchase history use cases record purchases and expose compact safe context", async () => {
  const repository = new InMemoryBuyerPurchaseHistoryRepository();
  const recordPurchase = new RecordCompletedPurchaseUseCase(repository);
  const getContext = new GetBuyerPurchaseContextUseCase(repository);

  const recorded = await recordPurchase.execute({
    merchantId: "mrc_1",
    orderId: "ord_1",
    globalUserId: "usr_global_1",
    currency: "BRL",
    totalAmount: 120,
    discountAmount: 12,
    completedAt: "2026-04-01T12:00:00.000Z",
    items: [{ sku: "sku_1", title: "Item", categoryId: "cat_1", quantity: 1, unitPrice: 120, discountAmount: 12 }]
  });
  const duplicated = await recordPurchase.execute({
    merchantId: "mrc_1",
    orderId: "ord_1",
    globalUserId: "usr_global_1",
    currency: "BRL",
    totalAmount: 120,
    discountAmount: 12,
    completedAt: "2026-04-01T12:00:00.000Z",
    items: [{ sku: "sku_1", title: "Item", categoryId: "cat_1", quantity: 1, unitPrice: 120, discountAmount: 12 }]
  });

  const context = await getContext.execute({
    merchantId: "mrc_1",
    globalUserId: "usr_global_1"
  });

  assert.equal(recorded.recorded, true);
  assert.equal(recorded.idempotent, false);
  assert.equal(duplicated.idempotent, true);
  assert.equal(context.purchase_history.known_buyer, true);
  assert.equal(context.purchase_history.orders_count, 1);
  assert.deepEqual(context.purchase_history.top_categories, ["cat_1"]);
  assert.equal("items" in context.purchase_history, false);
});

test("buyer purchase history context stays tenant-safe and safe for unknown buyers", async () => {
  const repository = new InMemoryBuyerPurchaseHistoryRepository();
  const recordPurchase = new RecordCompletedPurchaseUseCase(repository);
  const getContext = new GetBuyerPurchaseContextUseCase(repository);

  await recordPurchase.execute({
    merchantId: "mrc_1",
    orderId: "ord_1",
    globalUserId: "usr_global_1",
    currency: "BRL",
    totalAmount: 90,
    discountAmount: 0,
    completedAt: "2026-04-01T12:00:00.000Z",
    items: [{ sku: "sku_1", title: "Item", quantity: 1, unitPrice: 90, discountAmount: 0 }]
  });

  const otherMerchantContext = await getContext.execute({
    merchantId: "mrc_2",
    globalUserId: "usr_global_1"
  });
  const unknownContext = await getContext.execute({
    merchantId: "mrc_1",
    globalUserId: "usr_global_2"
  });

  assert.equal(otherMerchantContext.purchase_history.known_buyer, false);
  assert.equal(otherMerchantContext.purchase_history.orders_count, 0);
  assert.equal(unknownContext.purchase_history.known_buyer, false);
  assert.deepEqual(unknownContext.purchase_history.recent_skus, []);
});

test("buyer purchase history use cases emit metering seams for future billing", async () => {
  const repository = new InMemoryBuyerPurchaseHistoryRepository();
  const metering = new RecordingMeteringPort();
  const recordPurchase = new RecordCompletedPurchaseUseCase(repository, metering);
  const getContext = new GetBuyerPurchaseContextUseCase(repository, metering);

  await recordPurchase.execute({
    merchantId: "mrc_1",
    orderId: "ord_1",
    globalUserId: "usr_global_1",
    currency: "BRL",
    totalAmount: 90,
    discountAmount: 0,
    completedAt: "2026-04-01T12:00:00.000Z",
    items: [{ sku: "sku_1", title: "Item", quantity: 1, unitPrice: 90, discountAmount: 0 }]
  });
  await getContext.execute({
    merchantId: "mrc_1",
    globalUserId: "usr_global_1"
  });

  assert.deepEqual(
    metering.events.map((event) => event.eventType),
    ["purchase_history.imported_order", "purchase_history.context_used"]
  );
  assert.equal(metering.events[0]?.units, 1);
  assert.equal(metering.events[1]?.metadata?.orders_count, 1);
});
