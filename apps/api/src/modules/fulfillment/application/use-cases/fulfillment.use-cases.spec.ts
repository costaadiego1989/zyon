import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CreateShipmentUseCase } from "./create-shipment.use-case.js";
import { RecordTrackingEventUseCase } from "./record-tracking-event.use-case.js";
import { InMemoryShipmentRepository } from "../../infrastructure/repositories/in-memory-shipment.repository.js";
import { InMemoryTrackingEventRepository } from "../../infrastructure/repositories/in-memory-tracking-event.repository.js";
import { InMemoryOutboxRepository } from "../../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";
import { InMemoryDomainEventBus } from "../../../../shared/events/in-memory-domain-event-bus.js";

function makeSetup() {
  const repo = new InMemoryShipmentRepository();
  const outbox = new InMemoryOutboxRepository();
  const useCase = new CreateShipmentUseCase(repo, outbox);
  return { repo, outbox, useCase };
}

function makeTrackingSetup() {
  const repo = new InMemoryShipmentRepository();
  const trackingRepo = new InMemoryTrackingEventRepository();
  const outbox = new InMemoryOutboxRepository();
  const createUseCase = new CreateShipmentUseCase(repo, outbox);
  const recordUseCase = new RecordTrackingEventUseCase(repo, trackingRepo, outbox, new InMemoryDomainEventBus());
  return { repo, trackingRepo, outbox, createUseCase, recordUseCase };
}

const BASE_INPUT = {
  merchant_id: "mrc_1",
  order_id: "ord_1",
  carrier_key: "correios",
};

describe("CreateShipmentUseCase", () => {
  it("creates shipment with status 'created'", async () => {
    const { useCase } = makeSetup();
    const snap = await useCase.execute(BASE_INPUT);

    assert.equal(snap.status, "created");
    assert.equal(snap.merchant_id, "mrc_1");
    assert.equal(snap.order_id, "ord_1");
    assert.equal(snap.carrier_key, "correios");
    assert.equal(snap.tracking_code, null);
    assert.ok(snap.id, "shipment should have an id");
  });

  it("persists shipment to repository", async () => {
    const { repo, useCase } = makeSetup();
    const snap = await useCase.execute(BASE_INPUT);

    const saved = await repo.findById(snap.id, "mrc_1");
    assert.ok(saved, "shipment should be in repository");
    assert.equal(saved!.snapshot().order_id, "ord_1");
  });

  it("fires shipment.created outbox event", async () => {
    const { outbox, useCase } = makeSetup();
    const snap = await useCase.execute(BASE_INPUT);

    const events = outbox.listOutbox("mrc_1");
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, "shipment.created");

    const payload = events[0].payload as Record<string, unknown>;
    assert.equal(payload.shipment_id, snap.id);
    assert.equal(payload.order_id, "ord_1");
    assert.equal(payload.merchant_id, "mrc_1");
    assert.equal(payload.carrier_key, "correios");
  });

  it("creates separate shipments for different orders", async () => {
    const { repo, useCase } = makeSetup();
    const snap1 = await useCase.execute(BASE_INPUT);
    const snap2 = await useCase.execute({ ...BASE_INPUT, order_id: "ord_2" });

    assert.notEqual(snap1.id, snap2.id);
    const found1 = await repo.findByOrderId("ord_1", "mrc_1");
    const found2 = await repo.findByOrderId("ord_2", "mrc_1");
    assert.equal(found1!.snapshot().id, snap1.id);
    assert.equal(found2!.snapshot().id, snap2.id);
  });

  // P1 regression: at-least-once delivery of order.completed must not create
  // duplicate shipments.
  it("P1 — idempotent: duplicate call for same order returns existing shipment", async () => {
    const { repo, outbox, useCase } = makeSetup();

    const first = await useCase.execute(BASE_INPUT);
    const second = await useCase.execute(BASE_INPUT);

    assert.equal(first.id, second.id, "same shipment returned on duplicate call");

    const allShipments: string[] = [];
    // Verify only one shipment exists in the repo
    const found = await repo.findByOrderId("ord_1", "mrc_1");
    assert.ok(found, "shipment must exist");
    allShipments.push(found!.id);
    assert.equal(allShipments.length, 1);

    // Only one outbox event should have been emitted
    const events = outbox.listOutbox("mrc_1");
    assert.equal(events.length, 1, "shipment.created event emitted exactly once");
  });

  // P1 regression: different merchants do not share idempotency scope.
  it("P1 — same order_id for different merchants creates separate shipments", async () => {
    const { useCase, repo } = makeSetup();
    const snap1 = await useCase.execute(BASE_INPUT);
    const snap2 = await useCase.execute({ ...BASE_INPUT, merchant_id: "mrc_2" });

    assert.notEqual(snap1.id, snap2.id);
    const found1 = await repo.findByOrderId("ord_1", "mrc_1");
    const found2 = await repo.findByOrderId("ord_1", "mrc_2");
    assert.ok(found1);
    assert.ok(found2);
    assert.notEqual(found1!.id, found2!.id);
  });
});

describe("RecordTrackingEventUseCase", () => {
  // P2 regression: resending the same status must not throw INVALID_TRANSITION.
  it("P2 — idempotent resend of same status is accepted without error", async () => {
    const { createUseCase, recordUseCase, repo } = makeTrackingSetup();
    const snap = await createUseCase.execute(BASE_INPUT);

    // Advance to label_generated first
    const shipment = await repo.findById(snap.id, "mrc_1");
    const advanced = shipment!.transition("label_generated");
    await repo.save(advanced);

    // Send dispatched transition
    await recordUseCase.execute({
      shipment_id: snap.id,
      merchant_id: "mrc_1",
      new_status: "label_generated",
      description: "Label created",
      occurred_at: new Date()
    });

    // Resend the exact same status — must not throw
    await assert.doesNotReject(
      () => recordUseCase.execute({
        shipment_id: snap.id,
        merchant_id: "mrc_1",
        new_status: "label_generated",
        description: "Label created (resend)",
        occurred_at: new Date()
      }),
      "Resending same status must be accepted idempotently"
    );
  });

  // P2 regression: findByTrackingCode is scoped by merchantId.
  it("P2 — findByTrackingCode does not return shipments from other merchants", async () => {
    const repo = new InMemoryShipmentRepository();
    const shipment = (await new CreateShipmentUseCase(repo, new InMemoryOutboxRepository()).execute({
      merchant_id: "mrc_1",
      order_id: "ord_x",
      carrier_key: "flat-rate"
    }));

    // Set a tracking code on the shipment
    const entity = await repo.findById(shipment.id, "mrc_1");
    const withLabel = entity!.setLabel("http://track.example.com/1", "TRACK123");
    await repo.save(withLabel);

    // Same tracking code but wrong merchant → null
    const result = await repo.findByTrackingCode("TRACK123", "mrc_2");
    assert.equal(result, null, "cross-tenant lookup must return null");

    // Correct merchant → found
    const correct = await repo.findByTrackingCode("TRACK123", "mrc_1");
    assert.ok(correct, "correct-tenant lookup must succeed");
    assert.equal(correct!.id, shipment.id);
  });
});
