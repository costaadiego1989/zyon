import test from "node:test";
import assert from "node:assert/strict";
import { isRetryableCommerceError, retryWithBackoff } from "./commerce-retry.js";

const noSleep = async () => {};

test("classifies 5xx and 429 and network errors as retryable, 4xx as permanent", () => {
  assert.equal(isRetryableCommerceError(new Error("shopify_draft_order_failed_500")), true);
  assert.equal(isRetryableCommerceError(new Error("shopify_draft_order_failed_503")), true);
  assert.equal(isRetryableCommerceError(new Error("shopify_validate_cart_failed_429")), true);
  assert.equal(isRetryableCommerceError(new Error("ECONNRESET")), true);
  assert.equal(isRetryableCommerceError(new Error("shopify_validate_cart_failed_400")), false);
  assert.equal(isRetryableCommerceError(new Error("shopify_validate_cart_failed_404")), false);
});

test("retries transient failures then succeeds within maxAttempts", async () => {
  let calls = 0;
  const result = await retryWithBackoff(
    async () => {
      calls += 1;
      if (calls < 3) throw new Error("shopify_draft_order_failed_503");
      return "ok";
    },
    { maxAttempts: 3, sleep: noSleep }
  );
  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("does not retry permanent 4xx errors", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      retryWithBackoff(
        async () => {
          calls += 1;
          throw new Error("shopify_validate_cart_failed_422");
        },
        { maxAttempts: 5, sleep: noSleep }
      ),
    /422/
  );
  assert.equal(calls, 1);
});

test("gives up after maxAttempts on persistent transient failure", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      retryWithBackoff(
        async () => {
          calls += 1;
          throw new Error("shopify_mark_paid_failed_500");
        },
        { maxAttempts: 3, sleep: noSleep }
      ),
    /500/
  );
  assert.equal(calls, 3);
});
