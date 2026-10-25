import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { ExperimentMeasurementController } from "./experiment-measurement.controller.js";

const req = { user: { merchantId: "own-store", userId: "owner", email: "fixture@example.test", role: "owner" } };
test("measurement routes derive the store from authentication and reject forged inputs", async () => {
  const calls: unknown[][] = [];
  const controller = new ExperimentMeasurementController({
    read: async (...args: unknown[]) => { calls.push(args); },
    prepare: async (...args: unknown[]) => { calls.push(args); },
    capture: async (...args: unknown[]) => { calls.push(args); },
  } as never);
  await controller.read(req, "experiment");
  await controller.prepare(req, "experiment", {});
  await controller.capture(req, "experiment", { request_key: "snapshot-key" });
  assert.deepEqual(calls, [["own-store", "experiment"], ["own-store", "experiment"], ["own-store", "experiment", "snapshot-key"]]);
  for (const body of [{ merchant_id: "other" }, { conversions: 99 }, { approved_by: "other" }, []]) {
    assert.throws(() => controller.prepare(req, "experiment", body), /EXPERIMENT_PLAN_USES_SERVER_CONFIGURATION/);
  }
  for (const body of [{ request_key: "snapshot-key", merchant_id: "other" }, { request_key: 123 }, null, []]) {
    assert.throws(() => controller.capture(req, "experiment", body), /EXPERIMENT_REVIEW_KEY_REQUIRED/);
  }
  assert.equal(calls.length, 3);
});

test("measurement controller requires both authentication and plan eligibility", () => {
  const guards = Reflect.getMetadata("__guards__", ExperimentMeasurementController);
  assert.deepEqual(guards.map((g: { name: string }) => g.name), ["AuthGuard", "PlanLimitGuard"]);
});
