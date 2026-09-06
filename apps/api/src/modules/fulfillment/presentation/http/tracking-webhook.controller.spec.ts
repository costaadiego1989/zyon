import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
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
const MELHOR_ENVIO_SECRET = "test_melhor_envio_secret";
before(() => {
  process.env.TRACKING_WEBHOOK_SECRET = TEST_SECRET;
  process.env.MELHOR_ENVIO_WEBHOOK_SECRET = MELHOR_ENVIO_SECRET;
});

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
  it("accepts the documented Melhor Envio webhook and marks its shipment delivered", async () => {
    const { repo, trackingRepo, controller } = makeSetup();
    const shipment = await new CreateShipmentUseCase(repo, new InMemoryOutboxRepository()).execute({
      merchant_id: "mrc_1",
      order_id: "ord_1",
      carrier_key: "melhor-envio",
    });
    const created = (await repo.findById(shipment.id, "mrc_1"))!;
    await repo.save(created
      .setLabel("https://melhorenvio.test/label", "me-label-123")
      .transition("label_generated"));

    await ingestMelhorEnvio(controller, {
      event: "order.posted",
      data: {
        id: "me-label-123",
        status: "posted",
        posted_at: "2026-09-06T12:00:00.000Z",
      },
    });
    const delivered = await ingestMelhorEnvio(controller, {
      event: "order.delivered",
      data: {
        id: "me-label-123",
        status: "delivered",
        delivered_at: "2026-09-06T13:00:00.000Z",
      },
    });

    assert.equal((delivered as ShipmentSnapshot).status, "delivered");
    const events = await trackingRepo.findByShipment(shipment.id);
    assert.deepEqual(events.map((event) => event.snapshot().status), ["dispatched", "delivered"]);
  });

  it("rejects a Melhor Envio callback whose signature is not for the raw body", async () => {
    const { controller } = makeSetup();
    const body = { event: "order.posted", data: { id: "me-label-123", status: "posted" } };
    const rawBody = Buffer.from(JSON.stringify(body));
    await assert.rejects(
      () => controller.ingest("melhor-envio", {
        headers: { "x-me-signature": createHmac("sha256", MELHOR_ENVIO_SECRET).update("different").digest("base64") },
        rawBody,
      }, body as any),
      (err: unknown) => err instanceof Error && err.name === "UnauthorizedException",
    );
  });

  it("converges to delivered when an intermediate Melhor Envio callback was missed", async () => {
    const { repo, controller } = makeSetup();
    const shipment = await new CreateShipmentUseCase(repo, new InMemoryOutboxRepository()).execute({
      merchant_id: "mrc_1",
      order_id: "ord_2",
      carrier_key: "melhor-envio",
    });
    const created = (await repo.findById(shipment.id, "mrc_1"))!;
    await repo.save(created
      .setLabel("https://melhorenvio.test/label", "me-label-missed-event")
      .transition("label_generated"));

    const delivered = await ingestMelhorEnvio(controller, {
      event: "order.delivered",
      data: {
        id: "me-label-missed-event",
        status: "delivered",
        delivered_at: "2026-09-06T13:00:00.000Z",
      },
    });

    assert.equal((delivered as ShipmentSnapshot).status, "delivered");
  });

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

async function ingestMelhorEnvio(
  controller: TrackingWebhookController,
  body: Record<string, unknown>,
) {
  const rawBody = Buffer.from(JSON.stringify(body));
  const signature = createHmac("sha256", MELHOR_ENVIO_SECRET).update(rawBody).digest("base64");
  return controller.ingest("melhor-envio", {
    headers: { "x-me-signature": signature },
    rawBody,
  }, body as any);
}
