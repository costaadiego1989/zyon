import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CancelShipmentUseCase } from "./cancel-shipment.use-case.js";
import { CreateShipmentUseCase } from "./create-shipment.use-case.js";
import { RecordTrackingEventUseCase } from "./record-tracking-event.use-case.js";
import { InMemoryShipmentRepository } from "../../infrastructure/repositories/in-memory-shipment.repository.js";
import { InMemoryTrackingEventRepository } from "../../infrastructure/repositories/in-memory-tracking-event.repository.js";
import { InMemoryOutboxRepository } from "../../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";

function makeSetup() {
  const repo = new InMemoryShipmentRepository();
  const outbox = new InMemoryOutboxRepository();
  const createShipment = new CreateShipmentUseCase(repo, outbox);
  const cancel = new CancelShipmentUseCase(repo, outbox);
  return { repo, outbox, createShipment, cancel };
}

const BASE = { merchant_id: "mrc_1", order_id: "ord_1", carrier_key: "correios" };

describe("CancelShipmentUseCase", () => {
  it("cancels a shipment in 'created' state", async () => {
    const { createShipment, cancel } = makeSetup();
    const created = await createShipment.execute(BASE);

    const cancelled = await cancel.execute({ shipment_id: created.id, merchant_id: "mrc_1" });

    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.id, created.id);
  });

  it("persists cancelled state to repository", async () => {
    const { repo, createShipment, cancel } = makeSetup();
    const created = await createShipment.execute(BASE);
    await cancel.execute({ shipment_id: created.id, merchant_id: "mrc_1" });

    const fetched = await repo.findById(created.id, "mrc_1");
    assert.equal(fetched?.status, "cancelled");
  });

  it("publishes shipment.cancelled outbox event with merchant scope", async () => {
    const { outbox, createShipment, cancel } = makeSetup();
    const created = await createShipment.execute(BASE);
    await cancel.execute({ shipment_id: created.id, merchant_id: "mrc_1" });

    const events = outbox.listOutbox("mrc_1");
    const cancelEvent = events.find((e) => e.event_type === "shipment.cancelled");
    assert.ok(cancelEvent, "shipment.cancelled event must be present");

    const payload = cancelEvent!.payload as Record<string, unknown>;
    assert.equal(payload.shipment_id, created.id);
    assert.ok(typeof payload.cancelled_at === "string");
  });

  it("throws NotFoundException for unknown shipment", async () => {
    const { cancel } = makeSetup();
    await assert.rejects(
      () => cancel.execute({ shipment_id: "does-not-exist", merchant_id: "mrc_1" }),
      (err: unknown) => {
        return err instanceof Error && err.name === "NotFoundException";
      }
    );
  });

  it("tenant boundary: cannot cancel another merchant's shipment", async () => {
    const { repo, createShipment, cancel } = makeSetup();
    const created = await createShipment.execute({ ...BASE, merchant_id: "mrc_1" });

    await assert.rejects(
      () => cancel.execute({ shipment_id: created.id, merchant_id: "mrc_2" }),
      (err: unknown) => {
        return err instanceof Error && err.name === "NotFoundException";
      }
    );

    // Original shipment is unchanged
    const stillThere = await repo.findById(created.id, "mrc_1");
    assert.equal(stillThere?.status, "created");
  });

  it("rejects cancel on terminal 'delivered' shipment", async () => {
    const { repo, createShipment, cancel } = makeSetup();
    const created = await createShipment.execute(BASE);

    // Advance to delivered
    const trackingRepo = new InMemoryTrackingEventRepository();
    const outbox = new InMemoryOutboxRepository();
    const record = new RecordTrackingEventUseCase(repo, trackingRepo, outbox);
    const e1 = (await repo.findById(created.id, "mrc_1"))!;
    await repo.save(e1.transition("label_generated"));
    await record.execute({
      shipment_id: created.id,
      merchant_id: "mrc_1",
      new_status: "dispatched",
      description: "d",
      occurred_at: new Date()
    });
    const e2 = (await repo.findById(created.id, "mrc_1"))!;
    await repo.save(e2.transition("in_transit"));
    await record.execute({
      shipment_id: created.id,
      merchant_id: "mrc_1",
      new_status: "out_for_delivery",
      description: "o",
      occurred_at: new Date()
    });
    const e3 = (await repo.findById(created.id, "mrc_1"))!;
    await repo.save(e3.transition("delivered"));

    await assert.rejects(
      () => cancel.execute({ shipment_id: created.id, merchant_id: "mrc_1" }),
      (err: unknown) => {
        return err instanceof Error && /INVALID_TRANSITION/.test(err.message);
      }
    );
  });

  it("does not emit duplicate cancellation event on second cancel attempt", async () => {
    const { outbox, createShipment, cancel } = makeSetup();
    const created = await createShipment.execute(BASE);

    await cancel.execute({ shipment_id: created.id, merchant_id: "mrc_1" });

    const cancelAttempts = outbox
      .listOutbox("mrc_1")
      .filter((e) => e.event_type === "shipment.cancelled");
    assert.equal(cancelAttempts.length, 1, "single cancel event from first call");

    // Second cancel rejected, no additional events.
    await assert.rejects(
      () => cancel.execute({ shipment_id: created.id, merchant_id: "mrc_1" }),
      (err: unknown) => {
        return err instanceof Error && /INVALID_TRANSITION/.test(err.message);
      }
    );

    const cancelAttemptsAfter = outbox
      .listOutbox("mrc_1")
      .filter((e) => e.event_type === "shipment.cancelled");
    assert.equal(cancelAttemptsAfter.length, 1, "still single cancel event");
  });
});
