import { test } from "vitest";
import assert from "node:assert/strict";
import { normalizeCartRecoveryMetrics } from "./cart-recovery-metrics.js";

test("missing, invalid, and unavailable measurements stay unavailable", () => {
  for (const raw of [null, undefined, {}, { total_abandoned: NaN, revenue_recovered_brl: "150" }]) {
    assert.deepEqual(normalizeCartRecoveryMetrics(raw), {
      total_abandoned: null, total_attempts: null, total_recovered: null,
      recovery_rate_percent: null, revenue_recovered_brl: null,
    });
  }
  assert.equal(normalizeCartRecoveryMetrics({ revenue_recovered_brl: null, revenue_recovered_cents: 15000 }).revenue_recovered_brl, null);
});

test("observed zeros are preserved and cents are converted only at the API boundary", () => {
  assert.deepEqual(normalizeCartRecoveryMetrics({
    total_abandoned: null, recovery_attempts: 0, recovered: 0,
    recovery_rate: 0, revenue_recovered_cents: 10000,
  }), {
    total_abandoned: null, total_attempts: 0, total_recovered: 0,
    recovery_rate_percent: 0, revenue_recovered_brl: 100,
  });
  assert.equal(normalizeCartRecoveryMetrics({ revenue_recovered_brl: 100, revenue_recovered_cents: 10000 }).revenue_recovered_brl, 100);
});
