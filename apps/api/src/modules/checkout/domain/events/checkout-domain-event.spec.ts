import test from "node:test";
import assert from "node:assert/strict";
import { createCheckoutEventEnvelope } from "./checkout-domain-event.js";

test("createCheckoutEventEnvelope creates the required checkout event contract", () => {
  const event = createCheckoutEventEnvelope({
    eventType: "checkout.session.started",
    merchantId: "mrc_1",
    payload: { session_id: "chk_1" },
    correlationId: "corr_1",
    causationId: "cmd_1",
    occurredAt: new Date("2026-05-01T12:00:00.000Z")
  });

  assert.equal(event.event_type, "checkout.session.started");
  assert.equal(event.schema_version, 1);
  assert.equal(event.merchant_id, "mrc_1");
  assert.equal(event.producer, "checkout");
  assert.equal(event.occurred_at, "2026-05-01T12:00:00.000Z");
  assert.ok(event.event_id.startsWith("evt_"));
});
