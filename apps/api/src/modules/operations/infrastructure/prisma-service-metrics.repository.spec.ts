import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { PrismaServiceMetricsRepository } from "./prisma-service-metrics.repository.js";

// KPI-02/05: invalid scopes fail before a connection or transaction is opened.
// Result/persistence and snapshot isolation are proved by the SQL integration
// file, not by a mock returning the expected aggregate.
test("T85", async t => {
  let transactions = 0;
  const repository = new PrismaServiceMetricsRepository({
    $transaction: async () => { transactions++; throw new Error("unexpected_database_access"); },
  } as unknown as PrismaClient);
  const valid = { merchantId: "metrics-services", from: new Date("2026-11-19T03:00:00Z"), until: new Date("2026-11-20T03:00:00Z") };
  await t.test("rejects missing tenant and invalid half-open periods", async () => {
    for (const scope of [
      { ...valid, merchantId: "" },
      { ...valid, from: new Date("invalid") },
      { ...valid, until: valid.from },
      { ...valid, until: new Date("2026-11-18T03:00:00Z") },
      { ...valid, professionalId: "" },
      { ...valid, categoryId: "" },
    ]) await assert.rejects(() => repository.read(scope), /service_metrics_scope_invalid/);
    assert.equal(transactions, 0);
  });
  await t.test("rejects invalid batching limits rather than silently dropping facts", async () => {
    for (const limits of [{ pageSize: 0 }, { pageSize: 501 }, { maxRows: 0 }, { maxRows: 10_001 }, { pageSize: 1.5 }]) {
      await assert.rejects(() => repository.read({ ...valid, ...limits }), /service_metrics_scope_invalid/);
    }
    assert.equal(transactions, 0);
  });
});
