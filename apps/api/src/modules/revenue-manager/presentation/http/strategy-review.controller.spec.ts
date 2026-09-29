import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { StrategyReviewController } from "./strategy-review.controller.js";

test("strategy routes derive actor and tenant from authentication and reject client authority", async () => {
  const calls: unknown[][] = [];
  const controller = new StrategyReviewController({ decide: async (...args: unknown[]) => calls.push(args),
    read: async (...args: unknown[]) => calls.push(args), list: async (...args: unknown[]) => calls.push(args) } as never);
  const req = { user: { merchantId: "store", userId: "owner" } };
  const body = { version: 1, proposal_hash: "a".repeat(64), request_key: "request-1" };
  await controller.read(req, "proposal");
  await controller.revise(req, "proposal", body);
  assert.deepEqual(calls, [["store", "proposal"], ["store", "owner", "proposal", "revision", body]]);
  for (const key of ["merchant_id", "actor_id", "approved_by", "rules", "budget", "lift", "expires_at"]) {
    assert.throws(() => controller.approve(req, "proposal", { ...body, [key]: "forged" }), /STRATEGY_INVALID_REVIEW/);
  }
  for (const bad of [null, [], 1]) assert.throws(() => controller.reject(req, "proposal", bad));
  assert.equal(calls.length, 2);
});

test("strategy routes enforce authentication and billing plan guards", () => {
  assert.deepEqual(Reflect.getMetadata("__guards__", StrategyReviewController).map((guard: { name: string }) => guard.name), ["AuthGuard", "PlanLimitGuard"]);
});
