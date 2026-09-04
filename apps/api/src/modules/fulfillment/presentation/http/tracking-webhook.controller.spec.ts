import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { TrackingWebhookController } from "./tracking-webhook.controller.js";
import { RecordTrackingEventUseCase } from "../../application/use-cases/record-tracking-event.use-case.js";
import { CreateShipmentUseCase } from "../../application/use-cases/create-shipment.use-case.js";
import { ShipmentEntity } from "../../domain/entities/shipment.entity.js";
import { InMemoryShipmentRepository } from "../../infrastructure/repositories/in-memory-shipment.repository.js";
import { InMemoryTrackingEventRepository } from "../../infrastructure/repositories/in-memory-tracking-event.repository.js";
import { InMemoryOutboxRepository } from "../../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";
import { InMemoryDomainEventBus } from "../../../../shared/events/in-memory-domain-event-bus.js";
import type { ShipmentRepository } from "../../domain/ports/shipment-repository.port.js";
import type { ShipmentSnapshot } from "../../domain/entities/shipment.entity.js";

// Generic carriers (correios/ups/fedex) authenticate via a shared bearer secret.
const TEST_SECRET = "test_tracking_secret";
before(() => { process.env.TRACKING_WEBHOOK_SECRET = TEST_SECRET; });

// Mock authenticated request: bearer token matching the shared secret.
const AUTHED_REQ = { headers: { authorization: `Bearer ${TEST_SECRET}` } } as const;

function makeSetup(seedShipment?: ShipmentEntity) {
  const repo = new InMemoryShipmentRepository();
  const trackingRepo = new InMemoryTrackingEventRepository();
  const outbox = new InMemoryOutboxRepository();
  const create = new CreateShipmentUseCase(repo, outbox);
  const record = new RecordTrackingEventUseCase(repo, trackingRepo, outbox, new InMemoryDomainEventBus());
  const controller = new TrackingWebhookController(record, repo);

  return { repo, trackingRepo, outbox, create, record, controller };
}

const BASE = { merchant_id: "mrc_1", order_id: "ord_1", carrier_key: "correios" };

describe("TrackingWebhookController.ingest", () => {
  it("returns ignored when tracking_code is unknown", async () => {
    const { controller } = makeSetup();
    const result = await controller.ingest("correios", AUTHED_REQ as any, {
      tracking_code: "TRACK_MISSING",
      merchant_id: "mrc_1",
      status: "dispatched",
      description: "d",
      occurred_at: new Date().toISOString()
    });
    assert.deepEqual(result, { ignored: true, reason: "tracking_code_not_found" });
  });

  it("throws BadRequestException when merchant_id is missing", async () => {
    const { controller } = makeSetup();
    await assert.rejects(
      () =>
        controller.ingest("correios", AUTHED_REQ as any, {
          tracking_code: "TRACK_1",
          merchant_id: "",
          status: "dispatched",
          description: "d",
          occurred_at: new Date().toISOString()
        }),
      (err: unknown) => err instanceof Error && err.name === "BadRequestException"
    );
  });

  it("throws BadRequestException when merchant_id is whitespace", async () => {
    const { controller } = makeSetup();
    await assert.rejects(
      () =>
        controller.ingest("correios", AUTHED_REQ as any, {
          tracking_code: "TRACK_1",
          merchant_id: "   ",
          status: "dispatched",
          description: "d",
          occurred_at: new Date().toISOString()
        }),
      (err: unknown) => err instanceof Error && err.name === "BadRequestException"
    );
  });

  it("returns ignored for tracking_code from another tenant", async () => {
    const { repo, controller } = makeSetup();
    const snap = await new CreateShipmentUseCase(
      repo,
      new InMemoryOutboxRepository()
    ).execute({ ...BASE, merchant_id: "mrc_1" });

    const entity = (await repo.findById(snap.id, "mrc_1"))!;
    await repo.save(entity.setLabel("http://track.example.com/1", "TRACK_CROSS"));

    // Cross-tenant lookup returns ignored (no leak)
    const result = await controller.ingest("correios", AUTHED_REQ as any, {
      tracking_code: "TRACK_CROSS",
      merchant_id: "mrc_2",
      status: "dispatched",
      description: "d",
      occurred_at: new Date().toISOString()
    });
    assert.deepEqual(result, { ignored: true, reason: "tracking_code_not_found" });
  });

  it("records tracking event for matching tracking_code and merchant", async () => {
    const { repo, trackingRepo, controller } = makeSetup();
    const snap = await new CreateShipmentUseCase(
      repo,
      new InMemoryOutboxRepository()
    ).execute(BASE);

    const entity = (await repo.findById(snap.id, "mrc_1"))!;
    await repo.save(entity.setLabel("http://track.example.com/1", "TRACK_OK"));

    const result = await controller.ingest("correios", AUTHED_REQ as any, {
      tracking_code: "TRACK_OK",
      merchant_id: "mrc_1",
      status: "label_generated",
      description: "Label generated",
      location: "SAO PAULO, BR",
      occurred_at: new Date().toISOString()
    });

    const snap2 = result as ShipmentSnapshot;
    assert.equal(snap2.status, "label_generated");

    const events = await trackingRepo.findByShipment(snap.id);
    assert.equal(events.length, 1);
    assert.equal(events[0].snapshot().description, "Label generated");
    assert.equal(events[0].snapshot().location, "SAO PAULO, BR");
  });

  it("merges the carrier route param into carrier_raw on the recorded event", async () => {
    const { repo, trackingRepo, controller } = makeSetup();
    const snap = await new CreateShipmentUseCase(
      repo,
      new InMemoryOutboxRepository()
    ).execute(BASE);

    const entity = (await repo.findById(snap.id, "mrc_1"))!;
    await repo.save(entity.setLabel("http://track.example.com/1", "TRACK_MERGE"));

    await controller.ingest("ups", AUTHED_REQ as any, {
      tracking_code: "TRACK_MERGE",
      merchant_id: "mrc_1",
      status: "label_generated",
      description: "d",
      occurred_at: new Date().toISOString(),
      raw: { tracking_id: 123 }
    });

    const events = await trackingRepo.findByShipment(snap.id);
    const carrierRaw = events[0].snapshot().carrier_raw;
    assert.equal(carrierRaw["carrier"], "ups");
    assert.equal(carrierRaw["tracking_id"], 123);
  });

  it("uses empty carrier_raw when body omits raw and route param is still merged", async () => {
    const { repo, trackingRepo, controller } = makeSetup();
    const snap = await new CreateShipmentUseCase(
      repo,
      new InMemoryOutboxRepository()
    ).execute(BASE);

    const entity = (await repo.findById(snap.id, "mrc_1"))!;
    await repo.save(entity.setLabel("http://track.example.com/1", "TRACK_NORAW"));

    await controller.ingest("fedex", AUTHED_REQ as any, {
      tracking_code: "TRACK_NORAW",
      merchant_id: "mrc_1",
      status: "label_generated",
      description: "d",
      occurred_at: new Date().toISOString()
    });

    const events = await trackingRepo.findByShipment(snap.id);
    assert.equal(events[0].snapshot().carrier_raw["carrier"], "fedex");
  });

  it("trims merchant_id whitespace before lookup", async () => {
    const { repo, controller } = makeSetup();
    const snap = await new CreateShipmentUseCase(
      repo,
      new InMemoryOutboxRepository()
    ).execute(BASE);

    const entity = (await repo.findById(snap.id, "mrc_1"))!;
    await repo.save(entity.setLabel("http://track.example.com/1", "TRACK_TRIM"));

    const result = await controller.ingest("correios", AUTHED_REQ as any, {
      tracking_code: "TRACK_TRIM",
      merchant_id: "  mrc_1  ",
      status: "label_generated",
      description: "d",
      occurred_at: new Date().toISOString()
    });
    assert.equal((result as ShipmentSnapshot).status, "label_generated");
  });

  it("rejects illegal transition with BadRequestException (not 500)", async () => {
    const { repo, controller } = makeSetup();
    const snap = await new CreateShipmentUseCase(
      repo,
      new InMemoryOutboxRepository()
    ).execute(BASE);

    const entity = (await repo.findById(snap.id, "mrc_1"))!;
    await repo.save(entity.setLabel("http://track.example.com/1", "TRACK_BAD"));

    await assert.rejects(
      () =>
        controller.ingest("correios", AUTHED_REQ as any, {
          tracking_code: "TRACK_BAD",
          merchant_id: "mrc_1",
          status: "delivered",
          description: "skip-ahead",
          occurred_at: new Date().toISOString()
        }),
      (err: unknown) => err instanceof Error && err.name === "BadRequestException"
    );
  });
});
