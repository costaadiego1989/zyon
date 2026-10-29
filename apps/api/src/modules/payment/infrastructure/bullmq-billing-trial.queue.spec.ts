import test from "node:test";
import assert from "node:assert/strict";
import { Job } from "bullmq";
import { BullMqBillingTrialQueue } from "./bullmq-billing-trial.queue.js";

test("trial expiration uses a repeatable merchant job ID accepted by BullMQ", async () => {
  const ids: string[] = [];
  const queue = Object.create(BullMqBillingTrialQueue.prototype) as BullMqBillingTrialQueue;
  Object.assign(queue, { queue: { add: async (_name: string, data: unknown, opts: { jobId: string }) => {
    // Exercise the installed BullMQ validator without creating a Redis connection.
    (Job.prototype as any).validateOptions.call({ opts }, { data: JSON.stringify(data) });
    ids.push(opts.jobId);
  } } });
  for (const merchantId of ["merchant:one", "merchant:one", "merchant/two"]) {
    await queue.scheduleTrialExpiration({ merchantId, trialEndsAt: new Date(Date.now() + 86400000).toISOString() });
  }
  assert.equal(ids[0], ids[1]);
  assert.notEqual(ids[0], ids[2]);
});
