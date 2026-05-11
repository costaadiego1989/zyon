import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CreateShipmentUseCase } from "./create-shipment.use-case.js";
import { InMemoryShipmentRepository } from "../../infrastructure/repositories/in-memory-shipment.repository.js";
import { InMemoryOutboxRepository } from "../../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";

function makeSetup() {
  const repo = new InMemoryShipmentRepository();
  const outbox = new InMemoryOutboxRepository();
  const useCase = new CreateShipmentUseCase(repo, outbox);
  return { repo, outbox, useCase };
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
});
