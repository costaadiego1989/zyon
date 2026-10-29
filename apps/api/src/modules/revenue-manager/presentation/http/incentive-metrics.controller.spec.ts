import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { IncentiveMetricsController } from "./incentive-metrics.controller.js";

test("incentive metrics scopes the requested version to the authenticated merchant", async () => {
  const calls: unknown[][] = [];
  const controller = new IncentiveMetricsController({ read: async (...args: unknown[]) => calls.push(args) } as never);
  await controller.read({ user: { merchantId: "store", userId: "owner" } }, "strategy", "2");
  assert.deepEqual(calls, [["store", "strategy", 2]]);
  for (const version of ["", "1.5", "-1", "1e2", "1000000000", "2 OR 1=1"])
    assert.throws(() => controller.read({ user: { merchantId: "store" } }, "strategy", version), /INVALID_VERSION/);
  assert.equal(calls.length, 1);
  assert.deepEqual((Reflect.getMetadata("__guards__", IncentiveMetricsController) ?? []).map((g: { name: string }) => g.name), ["AuthGuard", "PlanLimitGuard"]);
});
