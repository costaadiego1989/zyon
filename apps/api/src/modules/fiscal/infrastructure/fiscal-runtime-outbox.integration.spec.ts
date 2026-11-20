import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createFiscalFixture } from "../../../../tests/fiscal-fixture.js";
import { OutboxDispatcher } from "../../../shared/messaging/outbox-dispatcher.service.js";
import { PrismaOutboxRepository } from "../../../shared/messaging/infrastructure/prisma-outbox.repository.js";
import { InMemoryDomainEventBus } from "../../../shared/events/in-memory-domain-event-bus.js";
import { createCheckoutEventEnvelope } from "../../checkout/domain/events/checkout-domain-event.js";
let f: Awaited<ReturnType<typeof createFiscalFixture>>;
before(
  async () => {
    f = await createFiscalFixture();
  },
  { timeout: 120000 }
);
after(async () => {
  await f?.close();
});
async function arrange(tick: () => Promise<void>, drainTimeoutMs = 1000) {
  const merchantId = f.tag + crypto.randomUUID();
  await f.prisma.merchant.create({
    data: { id: merchantId, name: "Original outbox owner" },
  });
  const repository = new PrismaOutboxRepository(f.prisma),
    bus = new InMemoryDomainEventBus();
  let handled = 0;
  bus.subscribe(
    "payment.status.changed",
    async () => {
      handled++;
    },
    "original-payment-handler"
  );
  const dispatcher = new OutboxDispatcher(
    repository,
    bus,
    { concurrency: 2, drainTimeoutMs },
    { tick }
  );
  const append = async () => {
    const event = createCheckoutEventEnvelope({
      eventType: "payment.status.changed",
      merchantId,
      payload: {
        session_id: "original",
        payment_intent_id: crypto.randomUUID(),
        status: "approved",
      },
    });
    await repository.appendOutbox(event);
    return event;
  };
  return {
    dispatcher,
    append,
    handled: () => handled,
    state: async (id: string) =>
      f.prisma.outboxMessage.findUniqueOrThrow({ where: { eventId: id } }),
  };
}
test("FISCAL-10 rejected fiscal background never blocks an unrelated durable payment event", async () => {
  const a = await arrange(async () => {
    throw new Error("synthetic fiscal table unavailable");
  });
  try {
    const event = await a.append();
    await a.dispatcher.dispatch();
    assert.equal(a.handled(), 1);
    assert.equal((await a.state(event.event_id)).status, "delivered");
  } finally {
    await a.dispatcher.onModuleDestroy();
  }
});
test("FISCAL-10 deferred fiscal background never delays unrelated durable payment delivery", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const a = await arrange(() => gate);
  try {
    const event = await a.append();
    const progressed = await Promise.race([
      a.dispatcher.dispatch().then(() => true),
      delay(1000).then(() => false),
    ]);
    assert.equal(progressed, true);
    assert.equal((await a.state(event.event_id)).status, "delivered");
  } finally {
    release();
    await a.dispatcher.onModuleDestroy();
  }
});
test("FISCAL-10 fiscal background stays single active across ordinary dispatch rounds and shutdown drains it", async () => {
  let release!: () => void,
    calls = 0;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const a = await arrange(() => {
    calls++;
    return gate;
  });
  try {
    await a.append();
    const first = a.dispatcher.dispatch();
    await Promise.race([first, delay(1000)]);
    await a.append();
    const second = a.dispatcher.dispatch();
    await Promise.race([second, delay(1000)]);
    assert.equal(a.handled(), 2);
    assert.equal(calls, 1);
    let drained = false;
    const shutdown = a.dispatcher.onModuleDestroy().then(() => {
      drained = true;
    });
    await delay(15);
    assert.equal(drained, false);
    release();
    await shutdown;
    assert.equal(drained, true);
    await a.dispatcher.dispatch();
    assert.equal(calls, 1);
  } finally {
    release();
    await a.dispatcher.onModuleDestroy();
  }
});
test("FISCAL-10 bounded shutdown stops scheduling without releasing or replaying a pending fiscal side effect", async () => {
  let release!: () => void,
    calls = 0;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const a = await arrange(() => {
    calls++;
    return gate;
  }, 20);
  try {
    const event = await a.append();
    await Promise.race([a.dispatcher.dispatch(), delay(1000)]);
    await a.dispatcher.onModuleDestroy();
    assert.equal(a.dispatcher.getStatus().stopping, true);
    await a.dispatcher.dispatch();
    assert.equal(calls, 1);
    assert.equal((await a.state(event.event_id)).status, "delivered");
  } finally {
    release();
    await a.dispatcher.onModuleDestroy();
  }
});
