import test from "node:test";
import assert from "node:assert/strict";
import { assertInterventionRecord } from "./intervention-record.entity.js";

test("InterventionRecord rejects empty merchant scoped fields", () => {
  assert.throws(
    () =>
      assertInterventionRecord({
        merchantId: " ",
        sessionId: "s1",
        occurredAtUnix: 1,
        reason: "agent_trigger_allowed"
      }),
    /intervention_merchant_required/
  );
  assert.throws(
    () =>
      assertInterventionRecord({
        merchantId: "m1",
        sessionId: "",
        occurredAtUnix: 1,
        reason: "agent_trigger_allowed"
      }),
    /intervention_session_required/
  );
  assert.throws(
    () =>
      assertInterventionRecord({
        merchantId: "m1",
        sessionId: "s1",
        occurredAtUnix: NaN,
        reason: "agent_trigger_allowed"
      }),
    /intervention_occurred_invalid/
  );
});
