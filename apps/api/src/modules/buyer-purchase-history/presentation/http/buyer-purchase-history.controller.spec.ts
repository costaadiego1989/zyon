import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryBuyerPurchaseHistoryRepository } from "../../infrastructure/in-memory-buyer-purchase-history.repository.js";
import { InMemoryBuyerIdentityRepository } from "../../infrastructure/in-memory-buyer-identity.repository.js";
import {
  GetBuyerPurchaseContextUseCase,
  RecordCompletedPurchaseUseCase
} from "../../application/buyer-purchase-history.use-cases.js";
import { BuyerPurchaseHistoryController } from "./buyer-purchase-history.controller.js";

test("BuyerPurchaseHistoryController returns safe context scoped by authenticated merchant", async () => {
  const repository = new InMemoryBuyerPurchaseHistoryRepository();
  const identityRepo = new InMemoryBuyerIdentityRepository();
  const recordPurchase = new RecordCompletedPurchaseUseCase(repository);
  const getContext = new GetBuyerPurchaseContextUseCase(repository);
  const controller = new BuyerPurchaseHistoryController(getContext, identityRepo);

  await recordPurchase.execute({
    merchantId: "mrc_auth",
    orderId: "ord_1",
    globalUserId: "usr_global_1",
    currency: "BRL",
    totalAmount: 180,
    discountAmount: 20,
    completedAt: "2026-04-01T12:00:00.000Z",
    items: [{ sku: "sku_1", title: "Item", categoryId: "cat_1", quantity: 1, unitPrice: 180, discountAmount: 20 }]
  });
  await recordPurchase.execute({
    merchantId: "mrc_other",
    orderId: "ord_1",
    globalUserId: "usr_global_1",
    currency: "BRL",
    totalAmount: 999,
    discountAmount: 0,
    completedAt: "2026-04-01T12:00:00.000Z",
    items: [{ sku: "sku_private", title: "Other", quantity: 1, unitPrice: 999, discountAmount: 0 }]
  });

  const context = await controller.getByGlobalUser(
    { user: { userId: "usr_owner", merchantId: "mrc_auth", email: "owner@example.com", role: "owner" } },
    "usr_global_1"
  );

  assert.equal(context.merchant_id, "mrc_auth");
  assert.equal(context.purchase_history.orders_count, 1);
  assert.deepEqual(context.purchase_history.recent_skus, ["sku_1"]);
  assert.equal("email" in context.purchase_history, false);
});
