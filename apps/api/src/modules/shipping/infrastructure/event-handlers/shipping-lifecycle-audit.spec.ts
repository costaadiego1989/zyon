import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { ShippingQuotesModule } from "../../shipping-quotes.module.js";
import { FulfillmentModule } from "../../../fulfillment/fulfillment.module.js";
import { InMemoryDomainEventBus } from "../../../../shared/events/in-memory-domain-event-bus.js";
import { InMemoryOutboxRepository } from "../../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";
import { OutboxDispatcher } from "../../../../shared/messaging/outbox-dispatcher.service.js";
import { createShippingEventEnvelope } from "../../domain/events/shipping-domain-event.js";
import { createFulfillmentEventEnvelope } from "../../../fulfillment/domain/events/fulfillment-domain-event.js";

const events = [
  { eventType: "shipping.quote.created", eventId: "event-quote", schemaVersion: 1, merchantId: "merchant-a", correlationId: "correlation",
    payload: { quote_id: "quote", session_id: "session", option_count: 2, expires_at: "2026-11-01T00:00:00.000Z", destination_zip: "PRIVATE", quote_key: "PRIVATE" } },
  { eventType: "shipment.created", eventId: "event-shipment", schemaVersion: 1, merchantId: "merchant-a", correlationId: "correlation",
    payload: { shipment_id: "shipment", order_id: "order", merchant_id: "merchant-a", carrier_key: "melhor-envio-1", address: "PRIVATE" } },
];
function fixture(fail = false) {
  const bus = new InMemoryDomainEventBus(), rows = new Map<string, any>(), instances: any[] = [];
  const prisma = { merchantAuditEvent: { upsert: async ({ where, create, update }: any) => {
    if (fail) throw Error("audit database unavailable");
    assert.equal(where.id, create.id); assert.deepEqual(update, {});
    if (!rows.has(where.id)) rows.set(where.id, create); return rows.get(where.id);
  } } };
  for (const [module, name] of [[ShippingQuotesModule, "ShippingQuoteCreatedAuditHandler"], [FulfillmentModule, "ShipmentCreatedAuditHandler"]] as const) {
    const providers = (Reflect.getMetadata("providers", module) ?? []).filter((p: any) => typeof p === "function" && p.name === name);
    assert.equal(providers.length, 1, `${name} must be registered in its owning production module`);
    const instance = new providers[0](bus, prisma); instance.onModuleInit(); instances.push(instance);
  }
  return { bus, rows, instances };
}

test("both informational events have one stable, module-owned durable consumer", () => {
  const f = fixture(); for (const instance of f.instances) instance.onModuleInit();
  for (const event of events) assert.equal(f.bus.handlersFor(event.eventType).length, 1);
  assert.equal(f.bus.handlersFor("shipment.dispatched").length, 0);
});

test("informational events create immutable tenant audit records without buyer data or shipping/payment actions", async () => {
  const f = fixture();
  for (const event of events) { await f.bus.publish(event); await f.bus.publish(event); }
  assert.equal(f.rows.size, 2);
  for (const row of f.rows.values()) {
    assert.equal(row.merchantId, "merchant-a"); assert.equal(row.actorType, "system");
    assert.equal(row.correlationId, "correlation"); assert.ok(row.metadata.sourceEventId);
    assert.equal(JSON.stringify(row).includes("PRIVATE"), false);
    assert.equal("destination_zip" in row.metadata, false); assert.equal("address" in row.metadata, false);
  }
});

test("new durable quote/shipment emissions complete their handler and outbox only after the audit is saved", async () => {
  const f = fixture(), repo = new InMemoryOutboxRepository(), dispatcher = new OutboxDispatcher(repo, f.bus);
  const envelopes = [createShippingEventEnvelope({ eventType: "shipping.quote.created", merchantId: "merchant-a", payload: events[0]!.payload }),
    createFulfillmentEventEnvelope({ eventType: "shipment.created", merchantId: "merchant-a", payload: events[1]!.payload })];
  for (const envelope of envelopes) repo.appendOutbox(envelope);
  await dispatcher.dispatch(); await dispatcher.dispatch();
  assert.equal(f.rows.size, 2);
  for (const envelope of envelopes) {
    assert.equal(repo.isProcessed(envelope.event_id), true);
    const registration = f.bus.handlersFor(envelope.event_type)[0]!;
    assert.equal(repo.isHandlerProcessed(envelope.event_id, registration.handlerId), true);
  }
});

test("audit persistence failure cannot acknowledge the event or its handler", async () => {
  const f = fixture(true), repo = new InMemoryOutboxRepository(), dispatcher = new OutboxDispatcher(repo, f.bus);
  const envelope = createShippingEventEnvelope({ eventType: "shipping.quote.created", merchantId: "merchant-a", payload: events[0]!.payload });
  repo.appendOutbox(envelope); await dispatcher.dispatch();
  assert.equal(repo.isProcessed(envelope.event_id), false);
  assert.equal(repo.isHandlerProcessed(envelope.event_id, f.bus.handlersFor(envelope.event_type)[0]!.handlerId), false);
  assert.equal(f.rows.size, 0);
});

test("malformed, unsupported-version and cross-tenant events fail before an audit write", async () => {
  const f = fixture();
  for (const event of events) for (const invalid of [
    { ...event, eventId: undefined }, { ...event, schemaVersion: 2 }, { ...event, payload: {} },
    { ...event, payload: { ...event.payload, merchant_id: "other" } },
  ]) await assert.rejects(f.bus.publish(invalid as any));
  assert.equal(f.rows.size, 0);
});

test("audit identity includes merchant scope and replay does not change the first record", async () => {
  const f = fixture(); const event = events[0]!;
  await f.bus.publish(event);
  await f.bus.publish({ ...event, payload: { ...event.payload, option_count: 99 } });
  await f.bus.publish({ ...event, merchantId: "merchant-b" });
  assert.equal(f.rows.size, 2);
  assert.equal([...f.rows.values()].find(r => r.merchantId === "merchant-a")!.metadata.optionCount, 2);
});
