import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryInterventionLedger } from "./in-memory-intervention-ledger.js";

test("InMemoryInterventionLedger increments count and exposes lastOccurredAt", async () => {
  const ledger = new InMemoryInterventionLedger();

  await ledger.record({
    merchantId: " mrc_a ",
    sessionId: " chk_1 ",
    occurredAtUnix: 100,
    reason: "agent_trigger_allowed"
  });
  await ledger.record({
    merchantId: "mrc_a",
    sessionId: "chk_1",
    occurredAtUnix: 140,
    reason: "agent_trigger_allowed"
  });

  assert.equal(ledger.countForSession("mrc_a", "chk_1"), 2);
  assert.equal(ledger.lastOccurredAt("mrc_a", "chk_1"), 140);
});

test("InMemoryInterventionLedger isolates sessions within the same merchant", async () => {
  const ledger = new InMemoryInterventionLedger();

  await ledger.record({
    merchantId: "mrc_b",
    sessionId: "chk_x",
    occurredAtUnix: 10,
    reason: "agent_trigger_allowed"
  });

  assert.equal(ledger.countForSession("mrc_b", "chk_y"), 0);
});
