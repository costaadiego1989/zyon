import test from "node:test";
import assert from "node:assert/strict";
import { ScanConsumableReordersUseCase } from "./scan-consumable-reorders.use-case.js";
test("same SKU in two merchants uses each merchant's product and reorder cycle", async () => {
  const scheduled: any[] = [];
  const prisma = { product: { findMany: async () => [
    { merchantId: "shop-a", name: "Produto A", metadata: { consumable: true, reorderCycleDays: 10 }, variants: [{ sku: "SKU-1" }] },
    { merchantId: "shop-b", name: "Produto B", metadata: { consumable: true, reorderCycleDays: 100 }, variants: [{ sku: "SKU-1" }] },
  ] }, completedOrder: { findMany: async () => ["shop-a", "shop-b"].map(merchantId => ({ merchantId, externalOrderId: merchantId + "-order", completedAt: new Date(Date.now() - 30 * 86400000), session: { globalUserId: "buyer", cart: { items: [{ sku: "SKU-1" }] } } })) } } as any;
  const messages = { findByOrderId: async () => [], create: async (input: any) => { scheduled.push(input); } } as any;
  const cfg = { getConfig: async () => ({ reorderEnabled: true }) } as any;
  await new ScanConsumableReordersUseCase(messages, prisma, cfg).execute();
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].merchantId, "shop-a");
  assert.equal(scheduled[0].productName, "Produto A");
});
