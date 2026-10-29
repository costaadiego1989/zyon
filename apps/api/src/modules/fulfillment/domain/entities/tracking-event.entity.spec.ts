import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TrackingEventEntity } from "./tracking-event.entity.js";

const BASE = {
  shipment_id: "shp_1",
  status: "in_transit" as const,
  description: "Departed facility",
  location: "SAO PAULO, BR",
  carrier_raw: { foo: "bar" },
  occurred_at: "2026-01-01T10:00:00.000Z"
};

describe("TrackingEventEntity", () => {
  it("create() assigns a unique id", () => {
    const e1 = TrackingEventEntity.create(BASE);
    const e2 = TrackingEventEntity.create(BASE);
    assert.ok(e1.id, "id present");
    assert.notEqual(e1.id, e2.id, "ids are unique");
  });

  it("create() preserves all fields", () => {
    const e = TrackingEventEntity.create(BASE);
    const snap = e.snapshot();
    assert.equal(snap.shipment_id, BASE.shipment_id);
    assert.equal(snap.status, BASE.status);
    assert.equal(snap.description, BASE.description);
    assert.equal(snap.location, BASE.location);
    assert.deepEqual(snap.carrier_raw, BASE.carrier_raw);
    assert.equal(snap.occurred_at, BASE.occurred_at);
  });

  it("create() supports null location", () => {
    const e = TrackingEventEntity.create({ ...BASE, location: null });
    assert.equal(e.snapshot().location, null);
  });

  it("rehydrate() preserves same id", () => {
    const e = TrackingEventEntity.create(BASE);
    const r = TrackingEventEntity.rehydrate(e.snapshot());
    assert.equal(r.id, e.id);
    assert.equal(r.snapshot().description, e.snapshot().description);
  });

  it("snapshot() returns a defensive copy", () => {
    const e = TrackingEventEntity.create(BASE);
    const s1 = e.snapshot();
    const s2 = e.snapshot();
    assert.notEqual(s1, s2);
    assert.deepEqual(s1, s2);
  });
});
