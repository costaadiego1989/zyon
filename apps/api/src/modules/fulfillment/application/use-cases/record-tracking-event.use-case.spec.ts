import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RecordTrackingEventUseCase } from "./record-tracking-event.use-case.js";
import { CreateShipmentUseCase } from "./create-shipment.use-case.js";
import { ShipmentEntity } from "../../domain/entities/shipment.entity.js";
import { InMemoryShipmentRepository } from "../../infrastructure/repositories/in-memory-shipment.repository.js";
import { InMemoryTrackingEventRepository } from "../../infrastructure/repositories/in-memory-tracking-event.repository.js";
import { InMemoryOutboxRepository } from "../../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";

function makeSetup() {
  const repo = new InMemoryShipmentRepository();
  const trackingRepo = new InMemoryTrackingEventRepository();
  const outbox = new InMemoryOutboxRepository();
  const create = new CreateShipmentUseCase(repo, outbox);
  const record = new RecordTrackingEventUseCase(repo, trackingRepo, outbox);
  return { repo, trackingRepo, outbox, create, record };
}

async function advanceTo(repo: InMemoryShipmentRepository, id: string, merchantId: string, status: ShipmentEntity["status"]) {
  const current = (await repo.findById(id, merchantId))!;
  // Walk by single legal transitions only.
  const path: ShipmentEntity["status"][] = ["created"];
  // For simplicity just rebuild via setLabel+transition manually.
  let entity = current;
  while (entity.status !== status) {
    if (entity.status === "created") {
      entity = entity.transition("label_generated");
    } else if (entity.status === "label_generated") {
      entity = entity.transition("dispatched");
    } else if (entity.status === "dispatched") {
      entity = entity.transition("in_transit");
    } else if (entity.status === "in_transit") {
      entity = entity.transition("out_for_delivery");
    } else {
      throw new Error(`cannot advance from ${entity.status}`);
    }
    await repo.save(entity);
  }
  return entity;
}

const BASE = { merchant_id: "mrc_1", order_id: "ord_1", carrier_key: "correios" };

describe("RecordTrackingEventUseCase — transitions & events", () => {
  it("records tracking event and advances status", async () => {
    const { repo, create, record } = makeSetup();
    const snap = await create.execute(BASE);
    await advanceTo(repo, snap.id, "mrc_1", "dispatched");

    const updated = await record.execute({
      shipment_id: snap.id,
      merchant_id: "mrc_1",
      new_status: "in_transit",
      description: "Picked up by carrier",
      location: "SAO PAULO, BR",
      occurred_at: new Date()
    });

    assert.equal(updated.status, "in_transit");

    const events = await record["trackingEvents"].findByShipment(snap.id);
    assert.equal(events.length, 1);
    assert.equal(events[0].snapshot().description, "Picked up by carrier");
    assert.equal(events[0].snapshot().location, "SAO PAULO, BR");
  });

  it("publishes shipment.status-updated event for status changes", async () => {
    const { repo, outbox, create, record } = makeSetup();
    const snap = await create.execute(BASE);
    await advanceTo(repo, snap.id, "mrc_1", "dispatched");

    await record.execute({
      shipment_id: snap.id,
      merchant_id: "mrc_1",
      new_status: "in_transit",
      description: "in transit",
      occurred_at: new Date()
    });

    const updates = outbox
      .listOutbox("mrc_1")
      .filter((e) => e.event_type === "shipment.status-updated");
    assert.equal(updates.length, 1);
    const p = updates[0].payload as Record<string, unknown>;
    assert.equal(p.old_status, "dispatched");
    assert.equal(p.new_status, "in_transit");
    assert.equal(p.shipment_id, snap.id);
  });

  it("publishes BOTH shipment.status-updated AND shipment.delivered on delivered transition", async () => {
    const { repo, outbox, create, record } = makeSetup();
    const snap = await create.execute(BASE);
    await advanceTo(repo, snap.id, "mrc_1", "out_for_delivery");

    await record.execute({
      shipment_id: snap.id,
      merchant_id: "mrc_1",
      new_status: "delivered",
      description: "delivered",
      occurred_at: new Date()
    });

    const delivered = outbox
      .listOutbox("mrc_1")
      .filter((e) => e.event_type === "shipment.delivered");
    const updated = outbox
      .listOutbox("mrc_1")
      .filter((e) => e.event_type === "shipment.status-updated");
    assert.equal(delivered.length, 1, "shipment.delivered emitted once");
    assert.equal(updated.length, 1, "shipment.status-updated emitted once");

    const dp = delivered[0].payload as Record<string, unknown>;
    assert.equal(dp.shipment_id, snap.id);
    assert.ok(typeof dp.delivered_at === "string");
  });

  it("does NOT emit status-updated event on idempotent same-status resend", async () => {
    const { repo, outbox, create, record } = makeSetup();
    const snap = await create.execute(BASE);
    await advanceTo(repo, snap.id, "mrc_1", "label_generated");

    // Apply same status twice
    await record.execute({
      shipment_id: snap.id,
      merchant_id: "mrc_1",
      new_status: "dispatched",
      description: "dispatched",
      occurred_at: new Date()
    });
    await record.execute({
      shipment_id: snap.id,
      merchant_id: "mrc_1",
      new_status: "dispatched",
      description: "dispatched (resend)",
      occurred_at: new Date()
    });

    const updates = outbox
      .listOutbox("mrc_1")
      .filter((e) => e.event_type === "shipment.status-updated");
    assert.equal(updates.length, 1, "only one status-updated event");
  });

  it("still records tracking event on idempotent same-status resend", async () => {
    const { repo, create, record } = makeSetup();
    const snap = await create.execute(BASE);
    await advanceTo(repo, snap.id, "mrc_1", "label_generated");

    await record.execute({
      shipment_id: snap.id,
      merchant_id: "mrc_1",
      new_status: "dispatched",
      description: "dispatched",
      occurred_at: new Date()
    });
    await record.execute({
      shipment_id: snap.id,
      merchant_id: "mrc_1",
      new_status: "dispatched",
      description: "dispatched (resend)",
      occurred_at: new Date()
    });

    const events = await record["trackingEvents"].findByShipment(snap.id);
    assert.equal(events.length, 2, "tracking events recorded for observability");
  });
});

describe("RecordTrackingEventUseCase — validation & boundaries", () => {
  it("throws BadRequestException when carrier_raw exceeds 16 KB", async () => {
    const { create, record } = makeSetup();
    const snap = await create.execute(BASE);

    const big = { blob: "x".repeat(17000) };
    await assert.rejects(
      () =>
        record.execute({
          shipment_id: snap.id,
          merchant_id: "mrc_1",
          new_status: "label_generated",
          description: "d",
          carrier_raw: big,
          occurred_at: new Date()
        }),
      (err: unknown) => err instanceof Error && err.name === "BadRequestException"
    );
  });

  it("accepts carrier_raw at exactly 16 KB", async () => {
    const { create, record } = makeSetup();
    const snap = await create.execute(BASE);

    const ok = { blob: "x".repeat(16000) };
    await assert.doesNotReject(() =>
      record.execute({
        shipment_id: snap.id,
        merchant_id: "mrc_1",
        new_status: "label_generated",
        description: "d",
        carrier_raw: ok,
        occurred_at: new Date()
      })
    );
  });

  it("throws BadRequestException on illegal transition (not the same status)", async () => {
    const { create, record } = makeSetup();
    const snap = await create.execute(BASE);

    // created → delivered is illegal
    await assert.rejects(
      () =>
        record.execute({
          shipment_id: snap.id,
          merchant_id: "mrc_1",
          new_status: "delivered",
          description: "d",
          occurred_at: new Date()
        }),
      (err: unknown) => {
        if (!(err instanceof Error)) return false;
        if (err.name !== "BadRequestException") return false;
        return /invalid_shipment_transition/.test(err.message);
      }
    );
  });

  it("throws NotFoundException for unknown shipment", async () => {
    const { record } = makeSetup();
    await assert.rejects(
      () =>
        record.execute({
          shipment_id: "missing",
          merchant_id: "mrc_1",
          new_status: "dispatched",
          description: "d",
          occurred_at: new Date()
        }),
      (err: unknown) => err instanceof Error && err.name === "NotFoundException"
    );
  });

  it("tenant boundary: cannot record tracking for another merchant's shipment", async () => {
    const { repo, create, record } = makeSetup();
    const snap = await create.execute({ ...BASE, merchant_id: "mrc_1" });
    const e = (await repo.findById(snap.id, "mrc_1"))!;
    await repo.save(e.transition("label_generated"));

    await assert.rejects(
      () =>
        record.execute({
          shipment_id: snap.id,
          merchant_id: "mrc_2",
          new_status: "dispatched",
          description: "d",
          occurred_at: new Date()
        }),
      (err: unknown) => err instanceof Error && err.name === "NotFoundException"
    );
  });

  it("defaults carrier_raw to {} when omitted", async () => {
    const { create, record } = makeSetup();
    const snap = await create.execute(BASE);
    const e = (await (record["shipments"] as InMemoryShipmentRepository).findById(snap.id, "mrc_1"))!;
    await (record["shipments"] as InMemoryShipmentRepository).save(e.transition("label_generated"));

    await record.execute({
      shipment_id: snap.id,
      merchant_id: "mrc_1",
      new_status: "dispatched",
      description: "d",
      occurred_at: new Date()
    });

    const events = await record["trackingEvents"].findByShipment(snap.id);
    assert.deepEqual(events[0].snapshot().carrier_raw, {});
    assert.equal(events[0].snapshot().location, null);
  });
});
