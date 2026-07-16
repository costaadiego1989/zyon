import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FulfillmentOnOrderCompletedHandler } from "./on-order-completed.handler.js";
import { CreateShipmentUseCase } from "../../application/use-cases/create-shipment.use-case.js";
import { InMemoryShipmentRepository } from "../repositories/in-memory-shipment.repository.js";
import { InMemoryOutboxRepository } from "../../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";
import type { DomainEvent, DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";

type Handler = (event: DomainEvent) => Promise<void>;

class FakeEventBus implements DomainEventBus {
  private handlers = new Map<string, { handlerId: string; handle: Handler }[]>();

  subscribe(eventType: string, handler: Handler, handlerId?: string): void {
    const existing = this.handlers.get(eventType) ?? [];
    existing.push({ handlerId: handlerId ?? "unknown", handle: handler });
    this.handlers.set(eventType, existing);
  }

  async publish(event: DomainEvent): Promise<void> {
    const handlers = this.handlers.get(event.eventType) ?? [];
    for (const h of handlers) {
      await h.handle(event);
    }
  }

  handlersFor(eventType: string) {
    return this.handlers.get(eventType) ?? [];
  }
}

function makeSetup() {
  const repo = new InMemoryShipmentRepository();
  const outbox = new InMemoryOutboxRepository();
  const eventBus = new FakeEventBus();
  const create = new CreateShipmentUseCase(repo, outbox);
  const handler = new FulfillmentOnOrderCompletedHandler(eventBus, create);
  return { repo, outbox, eventBus, create, handler };
}

describe("FulfillmentOnOrderCompletedHandler", () => {
  it("subscribes to order.completed on module init", () => {
    const { eventBus, handler } = makeSetup();
    handler.onModuleInit();

    const subs = eventBus.handlersFor("order.completed");
    assert.equal(subs.length, 1);
    assert.equal(subs[0].handlerId, "fulfillment.FulfillmentOnOrderCompletedHandler");
  });

  it("creates shipment using event payload fields when carrier_key provided", async () => {
    const { repo, eventBus, handler } = makeSetup();
    handler.onModuleInit();

    await eventBus.publish({
      eventType: "order.completed",
      merchantId: "mrc_1",
      payload: {
        external_order_id: "ord_42",
        carrier_key: "correios"
      }
    });

    const created = await repo.findByOrderId("ord_42", "mrc_1");
    assert.ok(created, "shipment must exist");
    assert.equal(created!.snapshot().carrier_key, "correios");
    assert.equal(created!.snapshot().merchant_id, "mrc_1");
    assert.equal(created!.snapshot().status, "created");
  });

  it("falls back to 'flat-rate' carrier_key when missing from payload", async () => {
    const { repo, eventBus, handler } = makeSetup();
    handler.onModuleInit();

    await eventBus.publish({
      eventType: "order.completed",
      merchantId: "mrc_1",
      payload: { external_order_id: "ord_no_carrier" }
    });

    const created = await repo.findByOrderId("ord_no_carrier", "mrc_1");
    assert.ok(created);
    assert.equal(created!.snapshot().carrier_key, "flat-rate");
  });

  it("ignores event when external_order_id is missing", async () => {
    const { repo, eventBus, handler } = makeSetup();
    handler.onModuleInit();

    await eventBus.publish({
      eventType: "order.completed",
      merchantId: "mrc_1",
      payload: { carrier_key: "correios" }
    });

    // No shipment created
    assert.equal((await repo.findByOrderId("undefined", "mrc_1")), null);
    // Repo should be empty (only contains nothing for any order_id)
    assert.equal((await repo.findById("any", "mrc_1")), null);
  });

  it("ignores empty-string carrier_key and defaults to flat-rate", async () => {
    const { repo, eventBus, handler } = makeSetup();
    handler.onModuleInit();

    await eventBus.publish({
      eventType: "order.completed",
      merchantId: "mrc_1",
      payload: { external_order_id: "ord_empty", carrier_key: "" }
    });

    const created = await repo.findByOrderId("ord_empty", "mrc_1");
    assert.ok(created);
    assert.equal(created!.snapshot().carrier_key, "flat-rate");
  });

  it("redelivered event for same order is idempotent (one shipment only)", async () => {
    const { repo, outbox, eventBus, handler } = makeSetup();
    handler.onModuleInit();

    const event = {
      eventType: "order.completed",
      merchantId: "mrc_1",
      payload: { external_order_id: "ord_dup", carrier_key: "correios" }
    } as DomainEvent;

    await eventBus.publish(event);
    await eventBus.publish(event);

    const created = await repo.findByOrderId("ord_dup", "mrc_1");
    assert.ok(created);

    const events = outbox.listOutbox("mrc_1");
    const shipmentCreated = events.filter((e) => e.event_type === "shipment.created");
    assert.equal(shipmentCreated.length, 1, "shipment.created emitted only once");
  });
});
