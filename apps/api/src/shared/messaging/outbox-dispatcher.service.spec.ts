import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { OutboxDispatcher } from "./outbox-dispatcher.service.js";
import { InMemoryOutboxRepository } from "./infrastructure/in-memory-outbox.repository.js";
import { InMemoryDomainEventBus } from "../events/in-memory-domain-event-bus.js";
import { createCheckoutEventEnvelope } from "../../modules/checkout/domain/events/checkout-domain-event.js";
import type { DomainEvent } from "../events/domain-event-bus.port.js";

const TEST_EVENT_TYPE = "payment.status.changed" as const;

function makeEnvelope(merchantId = "m1") {
  return createCheckoutEventEnvelope({
    eventType: TEST_EVENT_TYPE,
    merchantId,
    payload: { session_id: "s1", payment_intent_id: "pi1", status: "approved" }
  });
}

describe("OutboxDispatcher", () => {
  let dispatcher: OutboxDispatcher;
  let outbox: InMemoryOutboxRepository;
  let eventBus: InMemoryDomainEventBus;
  const received: DomainEvent[] = [];

  beforeEach(() => {
    outbox = new InMemoryOutboxRepository();
    eventBus = new InMemoryDomainEventBus();
    dispatcher = new OutboxDispatcher(outbox, eventBus);
    received.length = 0;
    eventBus.subscribe(TEST_EVENT_TYPE, async (e) => { received.push(e); });
  });

  it("dispatches pending events and marks them delivered", async () => {
    outbox.appendOutbox(makeEnvelope());

    await dispatcher.dispatch();

    assert.equal(received.length, 1);
    assert.equal(outbox.listPending().length, 0);
  });

  it("does not dispatch already delivered events (idempotency)", async () => {
    outbox.appendOutbox(makeEnvelope());

    await dispatcher.dispatch();
    await dispatcher.dispatch();

    assert.equal(received.length, 1);
  });

  it("marks event failed after 3 consecutive errors", async () => {
    eventBus.subscribe(TEST_EVENT_TYPE, async () => { throw new Error("downstream down"); });
    outbox.appendOutbox(makeEnvelope());

    await dispatcher.dispatch();
    await dispatcher.dispatch();
    await dispatcher.dispatch();

    assert.equal(outbox.listPending().length, 0);
  });

  it("dispatches multiple pending events in one cycle", async () => {
    outbox.appendOutbox(makeEnvelope("m1"));
    outbox.appendOutbox(makeEnvelope("m2"));

    await dispatcher.dispatch();

    assert.equal(received.length, 2);
  });
});
