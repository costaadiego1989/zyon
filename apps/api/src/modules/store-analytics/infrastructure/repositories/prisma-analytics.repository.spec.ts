import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PrismaAnalyticsRepository } from "./prisma-analytics.repository.js";

type Purchase = {
  id: string;
  orderId: string;
  merchantId: string;
  completedAt: Date;
  globalUserId: string | null;
  merchantCustomerId: string | null;
};

type PurchaseQuery = {
  where: {
    merchantId: string;
    completedAt: { gte?: Date; lte?: Date; lt?: Date };
    OR?: Array<{
      globalUserId?: { in: string[] };
      merchantCustomerId?: { in: string[] };
    }>;
  };
  select?: Record<string, boolean>;
};

const from = new Date("2026-09-04T00:00:00.000Z");
const to = new Date("2026-09-10T23:59:59.999Z");

function purchase(orderId: string, buyer: string | null, date = "2026-09-06T12:00:00.000Z", overrides: Partial<Purchase> = {}): Purchase {
  return {
    id: `purchase_${orderId}`,
    orderId,
    merchantId: "merchant_1",
    completedAt: new Date(date),
    globalUserId: buyer,
    merchantCustomerId: null,
    ...overrides,
  };
}

function repositoryWith(records: Purchase[]) {
  const calls: PurchaseQuery[] = [];
  const prisma = {
    buyerPurchaseRecord: {
      findMany: async (input: PurchaseQuery) => {
        calls.push(input);
        const { merchantId, completedAt, OR } = input.where;
        const rows = records.filter((record) =>
          record.merchantId === merchantId &&
          (!completedAt.gte || record.completedAt >= completedAt.gte) &&
          (!completedAt.lte || record.completedAt <= completedAt.lte) &&
          (!completedAt.lt || record.completedAt < completedAt.lt) &&
          (!OR || OR.some((condition) =>
            (record.globalUserId !== null && condition.globalUserId?.in.includes(record.globalUserId)) ||
            (record.merchantCustomerId !== null && condition.merchantCustomerId?.in.includes(record.merchantCustomerId)),
          )),
        );
        return input.select
          ? rows.map((record) => Object.fromEntries(Object.entries(record).filter(([key]) => input.select?.[key])))
          : rows;
      },
    },
  };
  return { repository: new PrismaAnalyticsRepository(prisma as never), calls };
}

function assertMetrics(actual: Record<string, unknown>, totalCustomers: number, newCustomers: number, returningCustomers: number, repeatRate: number) {
  assert.deepEqual(
    { totalCustomers: actual.totalCustomers, newCustomers: actual.newCustomers, returningCustomers: actual.returningCustomers, repeatRate: actual.repeatRate },
    { totalCustomers, newCustomers, returningCustomers, repeatRate },
  );
}

describe("PrismaAnalyticsRepository customer metrics", () => {
  it("finds each buyer's earlier purchase even when it happened months before the period", async () => {
    const { repository, calls } = repositoryWith([
      purchase("old-a", "buyer_a", "2026-01-01T12:00:00.000Z"),
      purchase("current-a", "buyer_a"),
      purchase("current-b", "buyer_b"),
      purchase("old-unrelated", "buyer_unrelated", "2026-01-01T12:00:00.000Z"),
    ]);
    assertMetrics(await repository.getCustomerMetrics("merchant_1", from, to), 2, 1, 1, 0.5);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].where.completedAt, { lt: from });
    assert.equal(calls[1].where.merchantId, "merchant_1");
  });

  it("counts two distinct orders in the same period as both a new and returning buyer", async () => {
    const { repository } = repositoryWith([
      purchase("first", "buyer_a"),
      purchase("second", "buyer_a", "2026-09-09T12:00:00.000Z"),
    ]);
    assertMetrics(await repository.getCustomerMetrics("merchant_1", from, to), 1, 1, 1, 1);
  });

  it("computes repeat rate for all-time without requiring a purchase before its start", async () => {
    const { repository } = repositoryWith([
      purchase("first-a", "buyer_a", "2026-01-01T12:00:00.000Z"),
      purchase("second-a", "buyer_a"),
      purchase("first-b", "buyer_b"),
    ]);
    assertMetrics(await repository.getCustomerMetrics("merchant_1", new Date(0), to), 2, 2, 1, 0.5);
  });

  it("returns zero safely for an empty period and skips a historical query", async () => {
    const { repository, calls } = repositoryWith([]);
    assertMetrics(await repository.getCustomerMetrics("merchant_1", from, to), 0, 0, 0, 0);
    assert.equal(calls.length, 1);
  });

  it("excludes anonymous orders even when there are multiple completed checkouts", async () => {
    const { repository, calls } = repositoryWith([
      purchase("anonymous-1", null),
      purchase("anonymous-2", null),
    ]);
    assertMetrics(await repository.getCustomerMetrics("merchant_1", from, to), 0, 0, 0, 0);
    assert.equal(calls.length, 1);
  });

  it("isolates both current and historical purchases from another merchant", async () => {
    const { repository, calls } = repositoryWith([
      purchase("current-a", "buyer_a"),
      purchase("other-old-a", "buyer_a", "2026-01-01T12:00:00.000Z", { merchantId: "merchant_2" }),
      purchase("other-current-a", "buyer_a", undefined, { merchantId: "merchant_2" }),
      purchase("other-current-b", "buyer_b", undefined, { merchantId: "merchant_2" }),
    ]);
    assertMetrics(await repository.getCustomerMetrics("merchant_1", from, to), 1, 1, 0, 0);
    assert.ok(calls.every((call) => call.where.merchantId === "merchant_1"));
  });

  it("does not mark a first purchase or a later out-of-period order as a repeat", async () => {
    const { repository } = repositoryWith([
      purchase("first", "buyer_a"),
      purchase("future", "buyer_a", "2026-09-11T00:00:00.000Z"),
    ]);
    assertMetrics(await repository.getCustomerMetrics("merchant_1", from, to), 1, 1, 0, 0);
  });

  it("counts a repeated purchase row only once by order ID", async () => {
    const { repository } = repositoryWith([
      purchase("same-order", "buyer_a"),
      purchase("same-order", "buyer_a", undefined, { id: "duplicate-record" }),
    ]);
    assertMetrics(await repository.getCustomerMetrics("merchant_1", from, to), 1, 1, 0, 0);
  });

  it("keeps identity namespaces distinct and uses the existing global identity precedence", async () => {
    const { repository } = repositoryWith([
      purchase("global", "shared", undefined, { merchantCustomerId: "shared" }),
      purchase("local-first", null, undefined, { merchantCustomerId: "shared" }),
      purchase("local-second", null, undefined, { merchantCustomerId: "shared" }),
    ]);
    assertMetrics(await repository.getCustomerMetrics("merchant_1", from, to), 2, 2, 1, 0.5);
  });

  it("uses inclusive supplied UTC boundaries for the selected period", async () => {
    const { repository, calls } = repositoryWith([
      purchase("start", "buyer_a", from.toISOString()),
      purchase("end", "buyer_a", to.toISOString()),
      purchase("just-before", "buyer_before", "2026-09-03T23:59:59.999Z"),
      purchase("just-after", "buyer_after", "2026-09-11T00:00:00.000Z"),
    ]);
    const result = await repository.getCustomerMetrics("merchant_1", from, to);
    assertMetrics(result, 1, 1, 1, 1);
    assert.deepEqual(calls[0].where.completedAt, { gte: from, lte: to });
    assert.deepEqual(result.period, { from, to });
  });
});
