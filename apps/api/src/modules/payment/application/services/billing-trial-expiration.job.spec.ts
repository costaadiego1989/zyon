import assert from "node:assert/strict";
import test from "node:test";
import { BillingTrialExpirationJob } from "./billing-trial-expiration.job.js";
import type { ExpireBillingTrialsUseCase } from "../payment-platform.use-cases.js";

test("BillingTrialExpirationJob runs trial expiration use case", async () => {
  const calls: Array<{ limit?: number }> = [];
  const useCase = {
    execute: async (input: { limit?: number }) => {
      calls.push(input);
      return 2;
    },
  } as ExpireBillingTrialsUseCase;

  const expired = await new BillingTrialExpirationJob(useCase).run();

  assert.equal(expired, 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.limit, 100);
});
