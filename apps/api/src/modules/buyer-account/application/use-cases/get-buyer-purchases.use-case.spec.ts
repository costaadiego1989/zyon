import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { GetBuyerPurchasesUseCase } from "./get-buyer-purchases.use-case.js";

test("GetBuyerPurchasesUseCase includes completed order tracking codes", async () => {
  const completedAt = new Date("2026-05-20T12:00:00.000Z");
  const prisma = {
    buyerPurchaseRecord: {
      findMany: async () => [
        {
          id: "purchase_1",
          merchantId: "mrc_1",
          orderId: "order_1",
          totalAmount: 199.9,
          discountAmount: 0,
          currency: "BRL",
          completedAt,
          items: [{ sku: "sku_1" }],
        },
      ],
    },
    merchant: {
      findMany: async () => [{ id: "mrc_1", name: "Loja Teste" }],
    },
    completedOrder: {
      findMany: async () => [
        {
          merchantId: "mrc_1",
          externalOrderId: "order_1",
          trackingCode: "BR123456789AA",
        },
      ],
    },
  } as unknown as PrismaClient;

  const page = await new GetBuyerPurchasesUseCase(prisma).execute({
    globalUserId: "guser_1",
  });

  assert.equal(page.records[0]?.merchantName, "Loja Teste");
  assert.equal(page.records[0]?.trackingCode, "BR123456789AA");
});

test("GetBuyerPurchasesUseCase returns null tracking while order is pending carrier code", async () => {
  const completedAt = new Date("2026-05-20T12:00:00.000Z");
  const prisma = {
    buyerPurchaseRecord: {
      findMany: async () => [
        {
          id: "purchase_1",
          merchantId: "mrc_1",
          orderId: "order_1",
          totalAmount: 199.9,
          discountAmount: 0,
          currency: "BRL",
          completedAt,
          items: [{ sku: "sku_1" }],
        },
      ],
    },
    merchant: {
      findMany: async () => [{ id: "mrc_1", name: "Loja Teste" }],
    },
    completedOrder: {
      findMany: async () => [
        {
          merchantId: "mrc_1",
          externalOrderId: "order_1",
          trackingCode: null,
        },
      ],
    },
  } as unknown as PrismaClient;

  const page = await new GetBuyerPurchasesUseCase(prisma).execute({
    globalUserId: "guser_1",
  });

  assert.equal(page.records[0]?.trackingCode, null);
});
