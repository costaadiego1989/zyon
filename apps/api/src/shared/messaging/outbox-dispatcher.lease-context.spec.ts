import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { DomainEventEnvelope } from "@zyon/shared-types";
import type { DomainEvent } from "../events/domain-event-bus.port.js";
import { InMemoryDomainEventBus } from "../events/in-memory-domain-event-bus.js";
import { InMemoryOutboxRepository } from "./infrastructure/in-memory-outbox.repository.js";
import { OutboxDispatcher } from "./outbox-dispatcher.service.js";
import { OUTBOX_LEASE_MS, type LeasedOutboxClaim } from "./ports/outbox.repository.port.js";

class OwnedClockOutbox extends InMemoryOutboxRepository {
  private time = Date.now();
  lastClaim?: LeasedOutboxClaim;
  protected override now() { return this.time; }
  advance(ms: number) { this.time += ms; }
  override claimBatch(size = 50) { const claims = super.claimBatch(size); if (claims[0]) this.lastClaim = claims[0]; return claims; }
}
function envelope(): DomainEventEnvelope {
  const id = randomUUID();
  return { event_id: randomUUID(), event_type: "whatsapp.support.message.requested", schema_version: 1,
    merchant_id: "merchant", occurred_at: new Date().toISOString(), correlation_id: "support_message:" + id,
    causation_id: id, producer: "support", payload: { messageId: id, ticketId: "ticket", bindingId: "binding", epoch: 2 } };
}

test("durable dispatch supplies its exact original private lease without adding it to the public envelope or payload", async () => {
  const outbox = new OwnedClockOutbox(), bus = new InMemoryDomainEventBus(), dispatcher = new OutboxDispatcher(outbox, bus), input = envelope();
  const received: DomainEvent[] = [];
  bus.subscribe(input.event_type, async event => {
    assert.ok(outbox.lastClaim); assert.equal(event.deliveryLeaseToken, outbox.lastClaim.leaseToken); received.push(event);
  }, "whatsapp.support.lease-proof");
  outbox.appendOutbox(input);
  try {
    await dispatcher.dispatch(); assert.equal(received.length, 1);
    const event = received[0]!; assert.equal(event.eventId, input.event_id); assert.equal(event.merchantId, input.merchant_id);
    assert.deepEqual(event.payload, input.payload); assert.equal(typeof event.deliveryLeaseToken, "string");
    assert.deepEqual(Object.getOwnPropertyDescriptor(event, "deliveryLeaseToken"), {
      value: event.deliveryLeaseToken, enumerable: false, writable: false, configurable: false,
    });
    assert.equal(Object.hasOwn({ ...event }, "deliveryLeaseToken"), false);
    assert.equal(JSON.stringify(event).includes("deliveryLeaseToken"), false);
    assert.equal(JSON.stringify(event).includes(event.deliveryLeaseToken!), false);
    assert.deepEqual(outbox.listOutbox(input.merchant_id), [input]);
    assert.equal(JSON.stringify(outbox.listOutbox(input.merchant_id)).includes(event.deliveryLeaseToken!), false);
    assert.equal(JSON.stringify(event.payload).includes(event.deliveryLeaseToken!), false);
    assert.equal(outbox.isProcessed(input.event_id), true);
  } finally { await dispatcher.onModuleDestroy(); }
});
test("a delayed handler retains its original lease after the row is reclaimed", async () => {
  const outbox = new OwnedClockOutbox(), bus = new InMemoryDomainEventBus(), dispatcher = new OutboxDispatcher(outbox, bus), input = envelope();
  let signalStarted: () => void = () => {}, release: () => void = () => {};
  const started = new Promise<void>(resolve => { signalStarted = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const received: DomainEvent[] = []; let originalToken: string | undefined;
  bus.subscribe(input.event_type, async event => { originalToken = event.deliveryLeaseToken; received.push(event); signalStarted(); await gate;
    assert.equal(event.deliveryLeaseToken, originalToken); }, "whatsapp.support.delayed-lease-proof");
  outbox.appendOutbox(input); const running = dispatcher.dispatch();
  try {
    await started; assert.equal(typeof originalToken, "string"); outbox.advance(OUTBOX_LEASE_MS + 1);
    const replacement = outbox.claimBatch(1)[0]; assert.ok(replacement); assert.notEqual(replacement.leaseToken, originalToken);
    release(); await running; assert.equal(received[0]!.deliveryLeaseToken, originalToken);
    assert.notEqual(received[0]!.deliveryLeaseToken, replacement.leaseToken); assert.equal(outbox.isProcessed(input.event_id), false);
  } finally { release(); await running; await dispatcher.onModuleDestroy(); }
});
test("an ordinary direct event does not acquire an outbox lease by its event name", async () => {
  const bus = new InMemoryDomainEventBus(), received: DomainEvent[] = [], input = envelope();
  bus.subscribe(input.event_type, async event => { received.push(event); }, "whatsapp.support.direct-proof");
  await bus.publish({ eventId: input.event_id, eventType: input.event_type, merchantId: input.merchant_id, payload: input.payload });
  assert.equal(received.length, 1); assert.equal(received[0]!.deliveryLeaseToken, undefined);
});
