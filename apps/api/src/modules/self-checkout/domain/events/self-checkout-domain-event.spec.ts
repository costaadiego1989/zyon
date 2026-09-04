import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSelfCheckoutEventEnvelope } from "./self-checkout-domain-event.js";

describe("createSelfCheckoutEventEnvelope", () => {
  it("creates envelope with all required fields", () => {
    const envelope = createSelfCheckoutEventEnvelope({
      eventType: "buyer.registered",
      merchantId: "mrc_1",
      payload: { global_user_id: "u1", email: "test@example.com" },
    });

    assert.ok(envelope.event_id.startsWith("evt_"));
    assert.equal(envelope.event_type, "buyer.registered");
    assert.equal(envelope.schema_version, 1);
    assert.equal(envelope.merchant_id, "mrc_1");
    assert.ok(envelope.occurred_at);
    assert.ok(envelope.correlation_id.startsWith("corr_"));
    assert.equal(envelope.causation_id, "buyer.registered");
    assert.equal(envelope.producer, "self-checkout");
    assert.deepEqual(envelope.payload, { global_user_id: "u1", email: "test@example.com" });
  });

  it("uses provided causationId when specified", () => {
    const envelope = createSelfCheckoutEventEnvelope({
      eventType: "buyer.consent.updated",
      merchantId: "platform",
      payload: { version: "v2" },
      causationId: "custom_cause",
    });

    assert.equal(envelope.causation_id, "custom_cause");
  });

  it("generates unique event_id and correlation_id per call", () => {
    const e1 = createSelfCheckoutEventEnvelope({
      eventType: "buyer.registered",
      merchantId: "mrc_1",
      payload: {},
    });
    const e2 = createSelfCheckoutEventEnvelope({
      eventType: "buyer.registered",
      merchantId: "mrc_1",
      payload: {},
    });

    assert.notEqual(e1.event_id, e2.event_id);
    assert.notEqual(e1.correlation_id, e2.correlation_id);
  });
});
