import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { IncentivePolicyController } from "./incentive-policy.controller.js";

test("incentive settings derive store and actor from authentication, never the body", async () => {
  const calls: unknown[][] = [];
  const controller = new IncentivePolicyController({ read: async (...args: unknown[]) => calls.push(args),
    save: async (...args: unknown[]) => calls.push(args) } as never);
  const req = { user: { merchantId: "store", userId: "owner" } };
  const body = { enabled: true, limitCents: 10000, maxDiscountCents: 500, maxRedemptions: 20, expectedVersion: 0, requestKey: "first" };
  await controller.read(req); await controller.save(req, body);
  assert.deepEqual(calls, [["store"], ["store", "owner", body]]);
  for (const key of ["merchantId", "actorId", "version", "policyHash", "approved", "minimumMarginPercent"])
    assert.throws(() => controller.save(req, { ...body, [key]: "forged" }), /INVALID_COMMAND/);
  for (const bad of [null, [], {}, "bad"]) assert.throws(() => controller.save(req, bad), /INVALID_COMMAND/);
  assert.equal(calls.length, 2);
});

test("incentive settings require authentication and the Revenue Manager plan", () => {
  assert.deepEqual(Reflect.getMetadata("__guards__", IncentivePolicyController).map((g: { name: string }) => g.name), ["AuthGuard", "PlanLimitGuard"]);
});
