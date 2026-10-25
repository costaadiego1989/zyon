import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { InMemoryTrackingEventRepository } from "./in-memory-tracking-event.repository.js";
import { TrackingEventEntity } from "../../domain/entities/tracking-event.entity.js";

const BASE = {
  shipment_id: "shp_1",
  status: "in_transit" as const,
  description: "Departed facility",
  location: "SAO PAULO, BR",
  carrier_raw: { foo: "bar" },
  occurred_at: "2026-01-01T10:00:00.000Z"
};

describe("InMemoryTrackingEventRepository", () => {
  it("save() persists event", async () => {
    const repo = new InMemoryTrackingEventRepository();
    const e = TrackingEventEntity.create(BASE);
    await repo.save(e);

    const all = await repo.findByShipment("shp_1");
    assert.equal(all.length, 1);
    assert.equal(all[0].id, e.id);
  });

  it("findByShipment() filters by shipment_id", async () => {
    const repo = new InMemoryTrackingEventRepository();
    await repo.save(TrackingEventEntity.create(BASE));
    await repo.save(TrackingEventEntity.create({ ...BASE, shipment_id: "shp_2" }));

    const all = await repo.findByShipment("shp_1");
    assert.equal(all.length, 1);
    assert.equal(all[0].snapshot().shipment_id, "shp_1");
  });

  it("findByShipment() returns empty array for unknown shipment", async () => {
    const repo = new InMemoryTrackingEventRepository();
    const all = await repo.findByShipment("nope");
    assert.deepEqual(all, []);
  });

  it("multiple events for same shipment preserved in insertion order", async () => {
    const repo = new InMemoryTrackingEventRepository();
    const e1 = TrackingEventEntity.create(BASE);
    const e2 = TrackingEventEntity.create({ ...BASE, description: "second" });
    const e3 = TrackingEventEntity.create({ ...BASE, description: "third" });
    await repo.save(e1);
    await repo.save(e2);
    await repo.save(e3);

    const events = await repo.findByShipment("shp_1");
    assert.equal(events.length, 3);
    assert.equal(events[0].id, e1.id);
    assert.equal(events[1].id, e2.id);
    assert.equal(events[2].id, e3.id);
  });
});
