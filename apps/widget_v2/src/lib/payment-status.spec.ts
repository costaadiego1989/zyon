// @ts-expect-error Node test types are supplied by the focused ready-prod runner.
import test from "node:test";
// @ts-expect-error Node assert types are supplied by the focused ready-prod runner.
import assert from "node:assert/strict";
import { paymentPollingOutcome } from "./payment-status.js";

test("payment polling completes only for approved payment states", () => {
  assert.equal(paymentPollingOutcome("approved"), "completed");
  assert.equal(paymentPollingOutcome(" PAID "), "completed");
  assert.equal(paymentPollingOutcome("confirmed"), "completed");
});

test("payment polling stops for terminal unsuccessful payment states", () => {
  for (const status of ["failed", "cancelled", "refunded", "chargeback_lost"]) {
    assert.equal(paymentPollingOutcome(status), "failed");
  }
});

test("payment polling keeps waiting for intermediate and unknown states", () => {
  assert.equal(paymentPollingOutcome("pending"), "pending");
  assert.equal(paymentPollingOutcome("requires_action"), "pending");
  assert.equal(paymentPollingOutcome(undefined), "pending");
});
