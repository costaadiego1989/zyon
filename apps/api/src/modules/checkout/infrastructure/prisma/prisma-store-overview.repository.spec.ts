import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { PrismaStoreOverviewRepository } from "./prisma-store-overview.repository.js";

const decimal = (value: number) => ({ toNumber: () => value });

test("store overview derives period KPIs from completed order snapshots", async () => {
  const prisma = new StoreOverviewPrismaStub();
  const repository = new PrismaStoreOverviewRepository(prisma as unknown as PrismaClient);

  const overview = await repository.storeOverview("merchant_1", "today");

  assert.equal(overview.revenue, 45);
  assert.equal(overview.orders_count, 2);
  assert.equal(overview.average_ticket, 22.5);
  assert.equal(overview.products_sold, 3);
  assert.equal(overview.new_customers, 1);
  assert.equal(overview.abandonment_rate, 0.6);
  assert.deepEqual(overview.top_products, [
    { product_id: "variant_legacy", name: "Produto legado", quantity: 2, revenue: 25 },
    { product_id: "variant_novo", name: "Produto novo", quantity: 1, revenue: 20 },
  ]);
  assert.deepEqual(overview.recent_orders.map((order) => order.buyer_name), ["Cliente novo", "Cliente recorrente"]);
  assert.equal(prisma.orderSessionLookupUsed, true);
  assert.equal(prisma.priorPurchaseLookupUsed, true);
});

class StoreOverviewPrismaStub {
  orderSessionLookupUsed = false;
  priorPurchaseLookupUsed = false;

  readonly completedOrder = {
    findMany: async ({ where }: { where: { completedAt: { lt?: Date } } }) => {
      if (where.completedAt.lt) {
        this.priorPurchaseLookupUsed = true;
        return [{ session: { globalUserId: "buyer_returning" } }];
      }

      return [
        {
          merchantId: "merchant_1",
          sessionId: "session_new",
          externalOrderId: "ORDER-NEW",
          orderTotal: decimal(20),
          currency: "BRL",
          status: "approved",
          lineItemsJson: [{ sku: "sku_new", variantId: "variant_novo", name: "Produto novo", unitPriceCents: 2000, quantity: 1 }],
          completedAt: new Date("2026-09-09T15:00:00.000Z"),
        },
        {
          merchantId: "merchant_1",
          // This checkout began before the selected period, but its completed order belongs to it.
          sessionId: "session_returning",
          externalOrderId: "ORDER-RETURNING",
          orderTotal: decimal(25),
          currency: "BRL",
          status: "approved",
          lineItemsJson: [{ sku: "sku_legacy", variantId: "variant_legacy", name: "Produto legado", unitPriceCents: 1250, quantity: 2 }],
          completedAt: new Date("2026-09-09T14:00:00.000Z"),
        },
      ];
    },
  };

  readonly checkoutSession = {
    count: async () => 5,
    findMany: async () => {
      this.orderSessionLookupUsed = true;
      return [
        {
          sessionId: "session_new",
          globalUserId: "buyer_new",
          customer: { fullName: "Cliente novo" },
          cart: { items: [] },
        },
        {
          sessionId: "session_returning",
          globalUserId: "buyer_returning",
          customer: { fullName: "Cliente recorrente" },
          cart: { items: [] },
        },
      ];
    },
  };
}
