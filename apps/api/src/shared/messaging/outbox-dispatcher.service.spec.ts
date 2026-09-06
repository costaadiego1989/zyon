import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { OutboxDispatcher } from "./outbox-dispatcher.service.js";
import { InMemoryOutboxRepository } from "./infrastructure/in-memory-outbox.repository.js";
import { InMemoryDomainEventBus } from "../events/in-memory-domain-event-bus.js";
import { createCheckoutEventEnvelope } from "../../modules/checkout/domain/events/checkout-domain-event.js";
import type { DomainEvent } from "../events/domain-event-bus.port.js";

const TEST_EVENT_TYPE = "payment.status.changed" as const;
const MAX_ATTEMPTS = 5;

class ClockOutbox extends InMemoryOutboxRepository {
  private currentTime = Date.now();
  protected override now(): number { return this.currentTime; }
  advance(ms: number): void { this.currentTime += ms; }
  override failClaim(...args: Parameters<InMemoryOutboxRepository["failClaim"]>) {
    const [claim, code, nextAttemptAt] = args;
    // Translate a wall-clock retry delay into this deterministic repository clock.
    return super.failClaim(claim, code, new Date(this.currentTime + Math.max(0, nextAttemptAt.getTime() - Date.now())));
  }
}

function makeEnvelope(merchantId = "m1") {
  return createCheckoutEventEnvelope({
    eventType: TEST_EVENT_TYPE,
    merchantId,
    payload: { session_id: "s1", payment_intent_id: "pi1", status: "approved" }
  });
}

describe("OutboxDispatcher", () => {
  let dispatcher: OutboxDispatcher;
  let outbox: ClockOutbox;
  let eventBus: InMemoryDomainEventBus;
  const received: DomainEvent[] = [];

  beforeEach(() => {
    outbox = new ClockOutbox();
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

  it("reschedules with backoff after a failure (not delivered, not dead)", async () => {
    const envelope = makeEnvelope();
    eventBus.subscribe(TEST_EVENT_TYPE, async () => { throw new Error("downstream down"); });
    outbox.appendOutbox(envelope);

    await dispatcher.dispatch();

    assert.equal(outbox.isProcessed(envelope.event_id), false);
    // Backoff pushes nextAttemptAt into the future, so it is not immediately claimable.
    assert.equal(outbox.claimBatch().length, 0);
  });

  it("moves event to DLQ after MAX_ATTEMPTS failures", async () => {
    const envelope = makeEnvelope();
    eventBus.subscribe(TEST_EVENT_TYPE, async () => { throw new Error("downstream down"); });
    outbox.appendOutbox(envelope);

    let outcome = { attempts: 0, dead: false };
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const claim = outbox.claimBatch()[0];
      outcome = outbox.failClaim(claim, "downstream_failed", new Date(0))!;
    }

    assert.equal(outcome.dead, true);
    assert.equal(outcome.attempts, MAX_ATTEMPTS);
    assert.equal(outbox.listPending().length, 0);
    assert.equal(outbox.claimBatch().length, 0);
  });

  it("dispatches multiple pending events in one cycle", async () => {
    outbox.appendOutbox(makeEnvelope("m1"));
    outbox.appendOutbox(makeEnvelope("m2"));

    await dispatcher.dispatch();

    assert.equal(received.length, 2);
  });

  it("does not re-run a succeeded handler when another handler fails", async () => {
    const envelope = makeEnvelope();
    const okCalls: string[] = [];
    let failCalls = 0;
    eventBus.subscribe(
      TEST_EVENT_TYPE,
      async () => {
        okCalls.push(envelope.event_id);
      },
      "handler.ok"
    );
    eventBus.subscribe(
      TEST_EVENT_TYPE,
      async () => {
        failCalls += 1;
        throw new Error("downstream down");
      },
      "handler.fails"
    );
    outbox.appendOutbox(envelope);

    // First tick: the ok handler succeeds, the failing one throws, event stays
    // pending. Force it immediately claimable again, then re-dispatch.
    await dispatcher.dispatch();
    outbox.advance(60_000);
    await dispatcher.dispatch();

    // The previously-subscribed default handler also counts, so filter by id.
    assert.equal(
      okCalls.filter((id) => id === envelope.event_id).length,
      1,
      "succeeded handler must run exactly once across retries"
    );
    assert.equal(failCalls, 2, "failing handler is retried");
    assert.equal(outbox.isProcessed(envelope.event_id), false);
  });

  it("marks the event delivered once every handler has succeeded", async () => {
    const envelope = makeEnvelope();
    let attempt = 0;
    eventBus.subscribe(
      TEST_EVENT_TYPE,
      async () => {
        attempt += 1;
        if (attempt === 1) throw new Error("transient");
      },
      "handler.flaky"
    );
    outbox.appendOutbox(envelope);

    await dispatcher.dispatch();
    assert.equal(outbox.isProcessed(envelope.event_id), false);

    outbox.advance(60_000);
    await dispatcher.dispatch();

    assert.equal(outbox.isProcessed(envelope.event_id), true);
  });

  it("skips overlapping dispatch ticks via in-process lock", async () => {
    outbox.appendOutbox(makeEnvelope());
    let inFlight = 0;
    let maxConcurrent = 0;
    eventBus.subscribe(TEST_EVENT_TYPE, async () => {
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await Promise.resolve();
      inFlight -= 1;
    });

    await Promise.all([dispatcher.dispatch(), dispatcher.dispatch()]);

    assert.equal(maxConcurrent, 1);
  });

  it("replicas claim distinct events and retain at most their available execution slots", async () => {
    const bus = new InMemoryDomainEventBus();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const seen: string[] = [];
    bus.subscribe(TEST_EVENT_TYPE, async (event) => { seen.push(event.eventId!); await gate; }, "bounded.handler");
    for (let index = 0; index < 25; index++) outbox.appendOutbox(makeEnvelope());
    const first = new OutboxDispatcher(outbox, bus, { concurrency: 2 });
    const second = new OutboxDispatcher(outbox, bus, { concurrency: 2 });
    const running = Promise.all([first.dispatch(), second.dispatch()]);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(seen.length, 4);
    assert.equal(outbox.getBacklog().processing, 4);
    assert.equal(outbox.getBacklog().pending, 21);
    release();
    await running;
    assert.equal(seen.length, 25);
    assert.equal(new Set(seen).size, 25);
  });

  it("does not claim more work after shutdown and drains active handlers before resolving", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const bus = new InMemoryDomainEventBus();
    bus.subscribe(TEST_EVENT_TYPE, async () => gate, "shutdown.handler");
    const worker = new OutboxDispatcher(outbox, bus, { concurrency: 1, drainTimeoutMs: 1_000 });
    const first = makeEnvelope();
    outbox.appendOutbox(first);
    outbox.appendOutbox(makeEnvelope());
    const run = worker.dispatch();
    await new Promise((resolve) => setImmediate(resolve));
    let stopped = false;
    const shutdown = worker.onModuleDestroy().then(() => { stopped = true; });
    await worker.dispatch();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(stopped, false);
    assert.equal(outbox.getBacklog().processing, 1);
    release();
    await Promise.all([run, shutdown]);
    assert.equal(outbox.isProcessed(first.event_id), true);
    assert.equal(outbox.getBacklog().pending, 1);
    assert.equal(worker.getStatus().inFlight, 0);
  });

  it("the drain deadline leaves active work leased and suppresses late markers until recovery", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const bus = new InMemoryDomainEventBus();
    bus.subscribe(TEST_EVENT_TYPE, async () => gate, "deadline.handler");
    const worker = new OutboxDispatcher(outbox, bus, { concurrency: 1, drainTimeoutMs: 10 });
    const envelope = makeEnvelope();
    outbox.appendOutbox(envelope);
    const run = worker.dispatch();
    await new Promise((resolve) => setImmediate(resolve));
    await worker.onModuleDestroy();
    assert.equal(worker.getStatus().abandoned, true);
    assert.equal(outbox.getBacklog().processing, 1);
    assert.equal(outbox.claimBatch().length, 0, "active effect must not be released at timeout");
    release();
    await run;
    assert.equal(outbox.isHandlerProcessed(envelope.event_id, "deadline.handler"), false);
    assert.equal(outbox.isProcessed(envelope.event_id), false);
    outbox.advance(120_001);
    assert.equal(outbox.claimBatch()[0].attempts, 2);
  });

  it("returns claims acquired during shutdown before handing them to a handler", async () => {
    const underlying = outbox.claimBatch.bind(outbox);
    let release!: () => void;
    let claimed!: () => void;
    const acquired = new Promise<void>((resolve) => { claimed = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const envelope = makeEnvelope();
    outbox.appendOutbox(envelope);
    // Simulate an in-flight database claim returning after shutdown starts.
    const proxy = new Proxy(outbox, { get(target, property) {
      if (property === "claimBatch") return async (size: number) => { const claims = underlying(size); claimed(); await gate; return claims; };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const worker = new OutboxDispatcher(proxy, eventBus, { drainTimeoutMs: 1_000 });
    const run = worker.dispatch();
    await acquired;
    const shutdown = worker.onModuleDestroy();
    release();
    await Promise.all([run, shutdown]);
    assert.equal(received.length, 0);
    const retried = outbox.claimBatch()[0];
    assert.equal(retried.envelope.event_id, envelope.event_id);
    assert.equal(retried.attempts, 1, "unstarted claims must not consume a delivery attempt");
  });

  it("missing or duplicate handlers never produce a delivered marker", async () => {
    for (const duplicate of [false, true]) {
      const local = new ClockOutbox();
      const bus = new InMemoryDomainEventBus();
      if (duplicate) {
        bus.subscribe(TEST_EVENT_TYPE, async () => { assert.fail("duplicate registrations must not run"); }, "same");
        bus.subscribe(TEST_EVENT_TYPE, async () => { assert.fail("duplicate registrations must not run"); }, "same");
      }
      const envelope = makeEnvelope();
      local.appendOutbox(envelope);
      await new OutboxDispatcher(local, bus).dispatch();
      assert.equal(local.isProcessed(envelope.event_id), false);
      assert.equal(local.getBacklog().pending, 1);
    }
  });

  it("a reclaimed lease fences stale acknowledgements and handler markers", () => {
    const envelope = makeEnvelope();
    outbox.appendOutbox(envelope);
    const old = outbox.claimBatch()[0];
    outbox.advance(120_001);
    const current = outbox.claimBatch()[0];
    assert.notEqual(old.leaseToken, current.leaseToken);
    assert.equal(outbox.renewClaim(old), false);
    assert.equal(outbox.completeHandler(old, "stale.handler"), false);
    assert.equal(outbox.completeClaim(old), false);
    assert.equal(outbox.failClaim(old, "stale", new Date(0)), null);
    assert.equal(outbox.releaseUnstartedClaim(old), false);
    assert.equal(outbox.completeHandler(current, "current.handler"), true);
    assert.equal(outbox.completeClaim(current), true);
  });

  it("rolls back append-on-failure and keeps listPending read-only", async () => {
    await assert.rejects(outbox.saveWithOutbox(async (tx) => {
      await tx.appendOutbox(makeEnvelope());
      throw new Error("transaction failed");
    }), /transaction failed/);
    assert.equal(outbox.listOutbox("m1").length, 0);
    const envelope = makeEnvelope();
    outbox.appendOutbox(envelope);
    assert.equal(outbox.listPending().length, 1);
    assert.equal(outbox.listPending().length, 1);
    assert.equal(outbox.claimBatch()[0].attempts, 1);
    assert.throws(() => outbox.markDelivered(envelope.event_id), /outbox_claim_required/);
  });
});
