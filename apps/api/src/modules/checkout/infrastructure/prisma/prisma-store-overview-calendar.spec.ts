import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { PrismaStoreOverviewRepository } from "./prisma-store-overview.repository.js";

test("series includes today-only sessions, zero-order dates and reconciles period totals", async context => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-06T21:00:00Z") });
  const sessions = [
    ...Array.from({ length: 17 }, (_, index) => ({ sessionId: `today-${index}`, createdAt: new Date("2026-10-06T15:00:00Z") })),
    { sessionId: "sale", createdAt: new Date("2026-10-02T12:00:00Z") },
  ];
  const orders = [{ sessionId: "sale", orderTotal: 29.9, completedAt: new Date("2026-10-02T12:05:00Z"), status: "approved", externalOrderId: "ORDER", lineItemsJson: [] }];
  const observed: unknown[] = [];
  const prisma = {
    completedOrder: { findMany: async (query: any) => { observed.push(query.where); return query.where.completedAt.lt ? [] : orders; } },
    checkoutSession: { count: async () => sessions.length, findMany: async (query: any) => {
      observed.push(query.where); return query.where.createdAt ? sessions : [];
    } },
  };
  const repository = new PrismaStoreOverviewRepository(prisma as unknown as PrismaClient);
  for (const period of ["7d", "30d", "90d"] as const) {
    const series = await repository.timeseries("merchant", period);
    const overview = await repository.storeOverview("merchant", period);
    assert.equal(series.sessions_daily.at(-1)?.date, "2026-10-06");
    assert.equal(series.sessions_daily.at(-1)?.value, 17);
    assert.equal(series.orders_daily.at(-1)?.value, 0);
    assert.equal(series.sessions_daily.reduce((sum, row) => sum + row.value, 0), 18);
    assert.equal(series.orders_daily.reduce((sum, row) => sum + row.value, 0), overview.orders_count);
    assert.equal(series.revenue_daily.reduce((sum, row) => sum + row.value, 0), overview.revenue);
    assert.equal(series.revenue_daily.length, Number(period.slice(0, -1)));
    assert.equal(series.conversion_daily.find(row => row.date === "2026-10-02")?.value, 1);
  }
  assert.equal(observed.every((where: any) => where.merchantId === "merchant"), true);
});
