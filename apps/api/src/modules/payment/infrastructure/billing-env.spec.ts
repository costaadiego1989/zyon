import assert from "node:assert/strict";
import test from "node:test";
import { billingPriceId, merchantConsoleUrl } from "./billing-env.js";

test("billing config rejects an absent paid-plan price in every runtime", () => {
  assert.throws(
    () => billingPriceId("growth", { NODE_ENV: "development" }),
    (error: unknown) => (error as { getStatus?: () => number }).getStatus?.() === 503,
  );
});

test("billing config accepts HTTPS console URLs and rejects invalid production origins", () => {
  assert.equal(merchantConsoleUrl({ NODE_ENV: "production", MERCHANT_CONSOLE_URL: "https://app.zyon-payments.com.br/path" }), "https://app.zyon-payments.com.br");
  assert.throws(
    () => merchantConsoleUrl({ NODE_ENV: "production", MERCHANT_CONSOLE_URL: "not a url" }),
    (error: unknown) => (error as { getStatus?: () => number }).getStatus?.() === 503,
  );
});
