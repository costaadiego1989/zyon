import assert from "node:assert/strict";
import test from "node:test";
import { MODULE_METADATA } from "@nestjs/common/constants.js";
import { BillingTrialExpirationJob } from "./application/services/billing-trial-expiration.job.js";
import { BILLING_TRIAL_JOB_QUEUE } from "./domain/ports/billing-trial-job-queue.port.js";
import { BullMqBillingTrialQueue, BullMqBillingTrialWorker } from "./infrastructure/bullmq-billing-trial.queue.js";
import { PaymentModule } from "./payment.module.js";

test("PaymentModule wires exact trial expiration through Redis with a reconciliation fallback", () => {
  const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, PaymentModule) as Array<unknown>;

  assert.ok(providers.includes(BullMqBillingTrialQueue));
  assert.ok(providers.includes(BullMqBillingTrialWorker));
  assert.ok(providers.includes(BillingTrialExpirationJob));
  assert.ok(providers.some((provider) =>
    typeof provider === "object" && provider !== null &&
    (provider as { provide?: unknown; useExisting?: unknown }).provide === BILLING_TRIAL_JOB_QUEUE &&
    (provider as { useExisting?: unknown }).useExisting === BullMqBillingTrialQueue,
  ));
});
