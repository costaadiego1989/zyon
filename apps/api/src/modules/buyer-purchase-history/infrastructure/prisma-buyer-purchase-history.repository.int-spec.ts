import test from "node:test";
import assert from "node:assert/strict";
import { createPrismaClient } from "../../../shared/persistence/prisma-client.js";
import { PrismaBuyerPurchaseHistoryRepository } from "./prisma-buyer-purchase-history.repository.js";

const runPrisma = process.env.AACP_RUN_PRISMA_TESTS === "1" && Boolean(process.env.DATABASE_URL);

test(
  "PrismaBuyerPurchaseHistoryRepository persists purchase history with idempotency and tenant isolation",
  { skip: runPrisma ? false : "Set AACP_RUN_PRISMA_TESTS=1 and DATABASE_URL to run Prisma integration tests." },
  async () => {
    const prisma = createPrismaClient();
    const repository = new PrismaBuyerPurchaseHistoryRepository(prisma);
    const merchantId = `mrc_bph_${crypto.randomUUID()}`;
    const otherMerchantId = `mrc_bph_${crypto.randomUUID()}`;
    const purchase = {
      merchantId,
      orderId: `ord_${crypto.randomUUID()}`,
      globalUserId: "usr_global_1",
      currency: "BRL" as const,
      totalAmount: 120,
      discountAmount: 12,
      completedAt: "2026-04-01T12:00:00.000Z",
      items: [{ sku: "sku_1", title: "Item", categoryId: "cat_1", quantity: 1, unitPrice: 120, discountAmount: 12 }]
    };

    try {
      const first = await repository.recordPurchase(purchase);
      const second = await repository.recordPurchase(purchase);
      await repository.recordPurchase({ ...purchase, merchantId: otherMerchantId, orderId: purchase.orderId });

      const found = await repository.getByBuyer({ merchantId, globalUserId: "usr_global_1" });
      const other = await repository.getByBuyer({ merchantId: otherMerchantId, globalUserId: "usr_global_1" });

      assert.equal(first.idempotent, false);
      assert.equal(second.idempotent, true);
      assert.equal(found?.stats().ordersCount, 1);
      assert.equal(other?.stats().ordersCount, 1);
      assert.equal(found?.toSafeContext().merchant_id, merchantId);
    } finally {
      await prisma.buyerPurchaseRecord.deleteMany({ where: { merchantId: { in: [merchantId, otherMerchantId] } } });
      await prisma.$disconnect();
    }
  }
);
