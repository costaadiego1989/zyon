import test from "node:test";
import assert from "node:assert/strict";
import { OrderTrackingNotificationListener } from "./order-tracking-notification.listener.js";
import { InMemoryDomainEventBus } from "../../../../shared/events/in-memory-domain-event-bus.js";
import { InMemoryOutboxRepository } from "../../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";
import { OutboxDispatcher } from "../../../../shared/messaging/outbox-dispatcher.service.js";
import { createCheckoutEventEnvelope } from "../../../checkout/domain/events/checkout-domain-event.js";
import type { WhatsAppSendResult } from "../../domain/ports/whatsapp-sender.port.js";

const payload = {
  template: "order_tracking", session_id: "chk_audit", external_order_id: "order_audit",
  phone: "11999990000", tracking_code: "BR123456789AA", message: "Rastreio BR123456789AA",
};

class TestOutbox extends InMemoryOutboxRepository {
  clock = Date.now();
  protected now() { return this.clock; }
}

test("tracking notification retries provider rejection and acknowledges only accepted delivery", async () => {
  const outbox = new TestOutbox();
  const bus = new InMemoryDomainEventBus();
  let calls = 0;
  new OrderTrackingNotificationListener(bus, { async send(input) {
    assert.deepEqual(input, { phone: payload.phone, message: payload.message });
    if (++calls === 1) throw new Error("provider_unavailable");
    return { status: "accepted" };
  } }).onModuleInit();
  const event = createCheckoutEventEnvelope({ eventType: "whatsapp.message.requested", merchantId: "mrc_audit", payload });
  outbox.appendOutbox(event);
  const dispatcher = new OutboxDispatcher(outbox, bus);
  await dispatcher.dispatch();
  assert.equal(outbox.isProcessed(event.event_id), false);
  assert.equal(outbox.getBacklog().pending, 1);
  outbox.clock += 60_000;
  await dispatcher.dispatch();
  assert.equal(outbox.isProcessed(event.event_id), true);
  await dispatcher.dispatch();
  assert.equal(calls, 2);
  await dispatcher.onModuleDestroy();
});

test("tracking without configured provider or without acceptance remains undelivered", async () => {
  for (const result of [{ status: "skipped", reason: "not_configured" }, undefined] as Array<WhatsAppSendResult | void>) {
    const bus = new InMemoryDomainEventBus();
    new OrderTrackingNotificationListener(bus, { async send() { return result; } }).onModuleInit();
    await assert.rejects(bus.publish({ eventType: "whatsapp.message.requested", merchantId: "mrc_audit", payload }), /delivery_not_accepted/);
  }
});

test("tracking consumer refuses campaigns, malformed payloads and missing merchant", async () => {
  const bus = new InMemoryDomainEventBus();
  let calls = 0;
  new OrderTrackingNotificationListener(bus, { async send() { calls++; return { status: "accepted" }; } }).onModuleInit();
  for (const bad of [null, { ...payload, template: "checkout_abandonment_discount" }, { ...payload, tracking_code: "" }]) {
    await assert.rejects(bus.publish({ eventType: "whatsapp.message.requested", merchantId: "mrc_audit", payload: bad }));
  }
  await assert.rejects(bus.publish({ eventType: "whatsapp.message.requested", merchantId: "", payload }));
  assert.equal(calls, 0);
});
