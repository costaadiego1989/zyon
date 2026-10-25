import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { PrismaPlatformCommerceRepository } from "./prisma-platform-commerce.repository.js";

test("PrismaPlatformCommerceRepository keeps store operations local and reads billing from the account", async () => {
  const subscriptionQueries: unknown[] = [];
  const receivableQueries: unknown[] = [];
  const repository = new PrismaPlatformCommerceRepository({
    merchant: {
      findUnique: async () => ({
        id: "child_store",
        name: "Loja filha",
        storeSlug: "loja-filha",
        storeCategory: null,
        plan: "BOTH",
        billingAccountMerchantId: "billing_account",
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
      }),
    },
    completedOrder: {
      aggregate: async () => ({ _count: { _all: 0 }, _sum: { orderTotal: null } }),
      findMany: async () => [],
    },
    merchantBillingSubscription: {
      findUnique: async (input: unknown) => {
        subscriptionQueries.push(input);
        return { status: "active", provider: "stripe", planKey: "scale", billingAmountCents: 74900, billingCycle: "monthly", currentPeriodEnd: null };
      },
    },
    billingReceivable: {
      findMany: async (input: unknown) => {
        receivableQueries.push(input);
        return [];
      },
    },
    aiUsageEvent: {
      aggregate: async () => ({ _sum: { totalTokens: 0, costMicros: 0n }, _count: { _all: 0 } }),
    },
  } as unknown as PrismaClient);

  const detail = await repository.merchantDetail("child_store", {
    from: new Date("2026-09-01T00:00:00.000Z"),
    to: new Date("2026-10-01T00:00:00.000Z"),
  });

  assert.equal(detail?.merchant.id, "child_store");
  assert.equal(detail?.billing.planKey, "scale");
  assert.deepEqual(subscriptionQueries, [{
    where: { merchantId: "billing_account" },
    select: { status: true, provider: true, planKey: true, billingAmountCents: true, billingCycle: true, currentPeriodEnd: true },
  }]);
  assert.deepEqual(receivableQueries, [{
    where: { merchantId: "billing_account", status: { in: ["open", "pending", "due", "overdue"] } },
    select: { status: true, dueAt: true },
    orderBy: { dueAt: "asc" },
  }]);
});
