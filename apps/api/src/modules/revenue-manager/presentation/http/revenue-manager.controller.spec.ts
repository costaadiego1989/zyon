import test from "node:test";
import assert from "node:assert/strict";
import { ServiceUnavailableException } from "@nestjs/common";
import { RevenueManagerController } from "./revenue-manager.controller.js";

function controller(enqueueMerchantRun: (merchantId: string) => Promise<string>) {
  return new RevenueManagerController(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { enqueueMerchantRun } as never,
  );
}

const request = { user: { merchantId: "merchant-a", email: "owner@example.com", role: "owner" } };

test("manual strategy trigger queues only the authenticated merchant", async () => {
  const queued: string[] = [];
  const result = await controller(async merchantId => {
    queued.push(merchantId);
    return "job-123";
  }).triggerObservation(request);

  assert.deepEqual(queued, ["merchant-a"]);
  assert.equal(result.job_id, "job-123");
});

test("manual strategy trigger reports an unavailable queue without synchronous fallback", async () => {
  await assert.rejects(
    controller(async () => { throw new Error("REVENUE_MANAGER_QUEUE_UNAVAILABLE"); }).triggerObservation(request),
    (error: unknown) => error instanceof ServiceUnavailableException && error.getStatus() === 503,
  );
});

test("manual strategy trigger maps a transient Redis failure to 503", async () => {
  await assert.rejects(
    controller(async () => { throw new Error("connect ECONNREFUSED redis"); }).triggerObservation(request),
    (error: unknown) => error instanceof ServiceUnavailableException && error.getStatus() === 503,
  );
});
