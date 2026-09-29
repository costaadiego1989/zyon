import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { IncentiveAlternativeController } from "./incentive-alternative.controller.js";
import { StrategyReviewService } from "../../application/strategy-review.service.js";

const input = { version: 1, proposal_hash: "a".repeat(64), recommendation_hash: "b".repeat(64), request_key: "alternative-1" };
test("financial alternative requires authenticated tenant/actor and paid feature", async () => {
  const calls: unknown[][] = [];
  const controller = new IncentiveAlternativeController({ requestIncentiveAlternative: async (...args: unknown[]) => calls.push(args) } as never);
  await controller.request({ user: { merchantId: "store", userId: "owner" } }, "strategy", input);
  assert.deepEqual(calls, [["store", "owner", "strategy", input]]);
  assert.deepEqual(Reflect.getMetadata("__guards__", IncentiveAlternativeController).map((guard: any) => guard.name), ["AuthGuard", "PlanLimitGuard"]);
  assert.equal(Reflect.getMetadata("__httpCode__", IncentiveAlternativeController.prototype.request), 202);
});
test("alternative rejects client financial authority and malformed commands before database or model access", async () => {
  const service = new StrategyReviewService({ $transaction: () => { throw new Error("must not persist"); } } as never, {} as never, {} as never, {} as never);
  for (const key of ["discount_percent", "max_discount_cents", "limit_cents", "actorId", "merchantId", "revision_scope", "expires_at", "policyHash"])
    await assert.rejects(service.requestIncentiveAlternative("store", "owner", "strategy", { ...input, [key]: 1 } as never), /INVALID_COMMAND/);
  for (const bad of [null, [], {}, { ...input, recommendation_hash: "bad" }, { ...input, version: 0 }, { ...input, feedback: "x".repeat(2001) }])
    await assert.rejects(service.requestIncentiveAlternative("store", "owner", "strategy", bad as never), /INVALID_COMMAND|INVALID_REVIEW/);
});
