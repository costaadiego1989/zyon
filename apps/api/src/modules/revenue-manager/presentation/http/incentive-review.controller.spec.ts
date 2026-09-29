import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { IncentiveReviewController } from "./incentive-review.controller.js";
import { IncentiveReviewService } from "../../application/incentive-review.service.js";

test("incentive review binds tenant and actor to authentication on every route", async () => {
  const calls: unknown[][] = [];
  const controller = new IncentiveReviewController({ decide: async (...args: unknown[]) => calls.push(args),
    read: async (...args: unknown[]) => calls.push(args) } as never);
  const req = { user: { merchantId: "store", userId: "owner" } };
  const command = { version: 1, proposal_hash: "a".repeat(64), recommendation_hash: "b".repeat(64), request_key: "review" };
  await controller.read(req, "strategy");
  for (const kind of ["approve", "reject", "withdraw"] as const) await controller[kind](req, "strategy", command);
  assert.deepEqual(calls, [["store", "strategy"], ...["approve", "reject", "withdraw"].map(kind => ["store", "owner", "strategy", kind, command])]);
});

test("all incentive review routes require authentication; only approval requires the paid feature", () => {
  const guards = (target: object) => (Reflect.getMetadata("__guards__", target) ?? []).map((g: { name: string }) => g.name);
  assert.deepEqual(guards(IncentiveReviewController), ["AuthGuard"]);
  assert.deepEqual(guards(IncentiveReviewController.prototype.approve), ["PlanLimitGuard"]);
  assert.deepEqual(guards(IncentiveReviewController.prototype.reject), []);
  assert.deepEqual(guards(IncentiveReviewController.prototype.withdraw), []);
});

test("review service rejects injected commercial authority and malformed commands before persistence", async () => {
  const service = new IncentiveReviewService({ $transaction: () => { throw new Error("must not persist"); } } as never, {} as never);
  const command = { version: 1, proposal_hash: "a".repeat(64), recommendation_hash: "b".repeat(64), request_key: "review" };
  for (const key of ["merchantId", "actorId", "approved_by", "budget", "discountPercent", "startsAt", "policyHash", "kind", "expiresAt"])
    await assert.rejects(service.decide("store", "owner", "strategy", "approve", { ...command, [key]: 1 }), /INVALID_COMMAND/);
  for (const bad of [null, [], 1, {}, { ...command, version: 1.5 }, { ...command, recommendation_hash: "wrong" },
    { ...command, request_key: "bad key" }, { ...command, feedback: "a".repeat(2001) }])
    await assert.rejects(service.decide("store", "owner", "strategy", "approve", bad as never), /INVALID_COMMAND/);
  for (const actor of ["", " ", "a".repeat(151)])
    await assert.rejects(service.decide("store", actor, "strategy", "approve", command), /INVALID_COMMAND/);
});
