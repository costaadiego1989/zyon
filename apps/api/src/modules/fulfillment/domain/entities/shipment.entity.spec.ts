import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ShipmentEntity } from "./shipment.entity.js";

const BASE = { merchant_id: "mrc_1", order_id: "ord_1", carrier_key: "correios" };

describe("ShipmentEntity state machine", () => {
  it("creates shipment with status 'created' and null tracking", () => {
    const s = ShipmentEntity.create(BASE);
    const snap = s.snapshot();
    assert.equal(snap.status, "created");
    assert.equal(snap.tracking_code, null);
    assert.equal(snap.dispatched_at, null);
    assert.equal(snap.delivered_at, null);
    assert.equal(snap.merchant_id, "mrc_1");
    assert.equal(snap.order_id, "ord_1");
    assert.equal(snap.carrier_key, "correios");
  });

  it("transitions created → label_generated", () => {
    const s = ShipmentEntity.create(BASE).transition("label_generated");
    assert.equal(s.snapshot().status, "label_generated");
  });

  it("transitions created → cancelled", () => {
    const s = ShipmentEntity.create(BASE).transition("cancelled");
    assert.equal(s.snapshot().status, "cancelled");
  });

  it("transitions label_generated → dispatched and sets dispatched_at", () => {
    const s = ShipmentEntity.create(BASE)
      .transition("label_generated")
      .transition("dispatched");
    const snap = s.snapshot();
    assert.equal(snap.status, "dispatched");
    assert.ok(snap.dispatched_at, "dispatched_at should be set");
  });

  it("transitions dispatched → in_transit", () => {
    const s = ShipmentEntity.create(BASE)
      .transition("label_generated")
      .transition("dispatched")
      .transition("in_transit");
    assert.equal(s.snapshot().status, "in_transit");
  });

  it("transitions in_transit → out_for_delivery", () => {
    const s = ShipmentEntity.create(BASE)
      .transition("label_generated")
      .transition("dispatched")
      .transition("in_transit")
      .transition("out_for_delivery");
    assert.equal(s.snapshot().status, "out_for_delivery");
  });

  it("transitions out_for_delivery → delivered and sets delivered_at", () => {
    const s = ShipmentEntity.create(BASE)
      .transition("label_generated")
      .transition("dispatched")
      .transition("in_transit")
      .transition("out_for_delivery")
      .transition("delivered");
    const snap = s.snapshot();
    assert.equal(snap.status, "delivered");
    assert.ok(snap.delivered_at, "delivered_at should be set");
  });

  it("transitions in_transit → returned", () => {
    const s = ShipmentEntity.create(BASE)
      .transition("label_generated")
      .transition("dispatched")
      .transition("in_transit")
      .transition("returned");
    assert.equal(s.snapshot().status, "returned");
  });

  it("throws INVALID_TRANSITION on illegal transition", () => {
    const s = ShipmentEntity.create(BASE);
    assert.throws(() => s.transition("delivered"), /INVALID_TRANSITION/);
  });

  it("throws INVALID_TRANSITION from terminal 'delivered'", () => {
    const s = ShipmentEntity.create(BASE)
      .transition("label_generated")
      .transition("dispatched")
      .transition("in_transit")
      .transition("out_for_delivery")
      .transition("delivered");
    assert.throws(() => s.transition("returned"), /INVALID_TRANSITION/);
  });

  it("throws INVALID_TRANSITION from terminal 'cancelled'", () => {
    const s = ShipmentEntity.create(BASE).transition("cancelled");
    assert.throws(() => s.transition("label_generated"), /INVALID_TRANSITION/);
  });
});
