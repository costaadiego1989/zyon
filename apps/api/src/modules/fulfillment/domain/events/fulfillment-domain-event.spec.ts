import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createFulfillmentEventEnvelope } from "./fulfillment-domain-event.js";

describe("createFulfillmentEventEnvelope", () => {
  it("builds an envelope with full required shape", () => {
    const env = createFulfillmentEventEnvelope({
      eventType: "shipment.created",
      merchantId: "mrc_1",
      payload: { shipment_id: "shp_1" }
    });

    assert.equal(env.event_type, "shipment.created");
    assert.equal(env.merchant_id, "mrc_1");
    assert.equal(env.producer, "fulfillment");
    assert.equal(env.schema_version, 1);
    assert.equal(env.causation_id, "shipment.created");
    assert.deepEqual(env.payload, { shipment_id: "shp_1" });
    assert.ok(env.event_id.startsWith("evt_"));
    assert.ok(env.correlation_id.startsWith("corr_"));
    assert.ok(typeof env.occurred_at === "string");
    assert.ok(!Number.isNaN(Date.parse(env.occurred_at)));
  });

  it("uses explicit causationId when provided", () => {
    const env = createFulfillmentEventEnvelope({
      eventType: "shipment.status-updated",
      merchantId: "mrc_1",
      payload: {},
      causationId: "evt_abc"
    });
    assert.equal(env.causation_id, "evt_abc");
  });

  it("produces unique event_id and correlation_id per call", () => {
    const a = createFulfillmentEventEnvelope({
      eventType: "shipment.delivered",
      merchantId: "mrc_1",
      payload: {}
    });
    const b = createFulfillmentEventEnvelope({
      eventType: "shipment.delivered",
      merchantId: "mrc_1",
      payload: {}
    });
    assert.notEqual(a.event_id, b.event_id);
    assert.notEqual(a.correlation_id, b.correlation_id);
  });
});
