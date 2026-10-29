import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { StrategyMetricsController } from "./strategy-metrics.controller.js";

test("strategy metrics bind authenticated store and reject supplied counts, times and keys", async () => {
  const calls: unknown[][] = [];
  const controller = new StrategyMetricsController({ read: async (...args: unknown[]) => calls.push(args) } as never);
  const req = { user: { merchantId: "store", userId: "owner" } };
  await controller.read(req, "strategy", "2");
  await controller.collect(req, "strategy", { version: 2 });
  assert.deepEqual(calls, [["store", "strategy", 2], ["store", "strategy", 2, true]]);
  for (const key of ["merchantId", "merchant_id", "executionId", "asOf", "conversions", "revenue", "request_key"]) {
    assert.throws(() => controller.collect(req, "strategy", { version: 2, [key]: "forged" }));
  }
  for (const bad of [undefined, "", "1e3", "-1", "1.2", "999999999999"]) {
    assert.throws(() => controller.read(req, "strategy", bad as any));
  }
  assert.equal(calls.length, 2);
  assert.deepEqual(Reflect.getMetadata("__guards__", StrategyMetricsController).map((g: any) => g.name), ["AuthGuard", "PlanLimitGuard"]);
});
