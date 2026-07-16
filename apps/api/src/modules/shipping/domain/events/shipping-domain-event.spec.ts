import test from "node:test";
import assert from "node:assert/strict";
import { createShippingEventEnvelope } from "./shipping-domain-event.js";

test("createShippingEventEnvelope stamps event_id, correlation_id and producer", () => {
  const env = createShippingEventEnvelope({
    eventType: "shipping.quote.created",
    merchantId: "mrc_1",
    payload: { quote_id: "qid_1" },
    causationId: "cause_1"
  });

  assert.ok(env.event_id.startsWith("evt_"), "event_id has evt_ prefix");
  assert.ok(env.correlation_id.startsWith("corr_"), "correlation_id has corr_ prefix");
  assert.equal(env.causation_id, "cause_1");
  assert.equal(env.producer, "shipping");
  assert.equal(env.merchant_id, "mrc_1");
  assert.equal(env.schema_version, 1);
  assert.equal(env.event_type, "shipping.quote.created");
});

test("createShippingEventEnvelope uses provided correlationId and occurredAt", () => {
  const ts = new Date("2026-05-01T12:00:00.000Z");
  const env = createShippingEventEnvelope({
    eventType: "shipping.method.selected",
    merchantId: "mrc_1",
    payload: { carrier_key: "pac" },
    correlationId: "corr_fixed",
    occurredAt: ts
  });

  assert.equal(env.correlation_id, "corr_fixed");
  assert.equal(env.occurred_at, ts.toISOString());
});

test("createShippingEventEnvelope falls back to event_type as causation_id when omitted", () => {
  const env = createShippingEventEnvelope({
    eventType: "shipping.method.selected",
    merchantId: "mrc_1",
    payload: {}
  });
  assert.equal(env.causation_id, "shipping.method.selected");
});
