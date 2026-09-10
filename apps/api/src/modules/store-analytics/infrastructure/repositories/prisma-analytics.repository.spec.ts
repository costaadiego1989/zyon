import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PrismaAnalyticsRepository } from "./prisma-analytics.repository.js";

describe("PrismaAnalyticsRepository customer metrics", () => {
  it("marks only buyers with their own earlier purchase as returning", async () => {
    const currentPurchases = [
      { id: "purchase_a", globalUserId: "buyer_a", merchantCustomerId: null },
      { id: "purchase_b", globalUserId: "buyer_b", merchantCustomerId: null },
    ];
    const previousPurchases = [
      { globalUserId: "buyer_a", merchantCustomerId: null },
    ];
    const calls: Array<Record<string, unknown>> = [];
    const prisma = {
      buyerPurchaseRecord: {
        findMany: async (input: Record<string, unknown>) => {
          calls.push(input);
          return calls.length === 1 ? currentPurchases : previousPurchases;
        },
      },
    };
    const repository = new PrismaAnalyticsRepository(prisma as never);

    const metrics = await repository.getCustomerMetrics(
      "merchant_1",
      new Date("2026-09-04T00:00:00.000Z"),
      new Date("2026-09-10T23:59:59.999Z"),
    );

    assert.equal(metrics.totalCustomers, 2);
    assert.equal(metrics.returningCustomers, 1);
    assert.equal(metrics.newCustomers, 1);
    assert.equal(metrics.repeatRate, 0.5);
    assert.equal(calls.length, 2);
  });

  it("does not infer retention from checkout activity without a buyer identity", async () => {
    const prisma = {
      buyerPurchaseRecord: {
        findMany: async () => [
          { id: "purchase_anon", globalUserId: null, merchantCustomerId: null },
        ],
      },
    };
    const repository = new PrismaAnalyticsRepository(prisma as never);

    const metrics = await repository.getCustomerMetrics(
      "merchant_1",
      new Date("2026-09-04T00:00:00.000Z"),
      new Date("2026-09-10T23:59:59.999Z"),
    );

    assert.equal(metrics.totalCustomers, 0);
    assert.equal(metrics.returningCustomers, 0);
    assert.equal(metrics.repeatRate, 0);
  });
});
