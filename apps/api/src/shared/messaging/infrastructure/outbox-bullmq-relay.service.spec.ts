import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { OutboxBullMqRelay } from "./outbox-bullmq-relay.service.js";
import { OutboxDispatcher } from "../outbox-dispatcher.service.js";
import { InMemoryOutboxRepository } from "./in-memory-outbox.repository.js";
import { InMemoryDomainEventBus } from "../../events/in-memory-domain-event-bus.js";
import { MetricsService } from "../../observability/metrics.service.js";

// Actual relay process, declared dispatcher/worker/metric doubles only. This
// does not start BullMQ, Redis, Nest HTTP, a provider or a durable dispatcher.
class ControlledDispatcher extends OutboxDispatcher {
  calls = 0;
  private releaseGate!: () => void;
  private readonly gate = new Promise<void>(resolve => { this.releaseGate = resolve; });
  failure?: Error;
  constructor() { super(new InMemoryOutboxRepository(), new InMemoryDomainEventBus()); }
  override async dispatch(): Promise<void> { this.calls++; await this.gate; if (this.failure) throw this.failure; }
  override getLastCompletedRoundAt(): number { return 123_000; }
  release() { this.releaseGate(); }
}
const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
function fixture() {
  const dispatcher = new ControlledDispatcher(), relay = new OutboxBullMqRelay(dispatcher);
  const metrics: number[] = [], order: string[] = [];
  Reflect.set(relay, "lastDispatch", { set(value: number) { metrics.push(value); } });
  const process = Reflect.get(relay, "process"); assert.equal(typeof process, "function");
  let active: Promise<void> = Promise.resolve();
  Reflect.set(relay, "worker", { async close() { order.push("worker:start"); await active; order.push("worker:closed"); } });
  Reflect.set(relay, "queue", { async close() { order.push("queue:closed"); } });
  return { dispatcher, relay, metrics, order, start() { active = Reflect.apply(process, relay, [{}]); return active; } };
}

test("shutdown drains the active dispatch once, preserves its metric and closes worker before queue without another wait", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
  const f = fixture(), active = f.start();
  assert.equal(f.dispatcher.calls, 1);
  let stopped = false;
  const closing = f.relay.onModuleDestroy().then(() => { stopped = true; });
  await flush(); assert.equal(stopped, false, "in-flight dispatch must drain, not be abandoned");
  f.dispatcher.release(); await flush();
  try {
    assert.equal(stopped, true, "shutdown must not wait out the 55-second recurring job window");
    assert.equal(f.dispatcher.calls, 1); assert.deepEqual(f.metrics, [123]);
    assert.deepEqual(f.order, ["worker:start", "worker:closed", "queue:closed"]);
  } finally {
    t.mock.timers.setTime(60_000); t.mock.timers.tick(1000); await flush();
    await Promise.all([active, closing]);
  }
});

test("a processing callback arriving after shutdown must never claim a dispatch pass", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
  const f = fixture(); await f.relay.onModuleDestroy();
  const active = f.start(); f.dispatcher.release(); await flush();
  try { assert.equal(f.dispatcher.calls, 0); assert.deepEqual(f.metrics, []); }
  finally { t.mock.timers.setTime(60_000); t.mock.timers.tick(1000); await flush(); await active; }
});

test("a failing active dispatch remains a failing graceful shutdown, never false success", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
  const f = fixture(), failure = new Error("synthetic_dispatch_failed"); f.dispatcher.failure = failure;
  const active = f.start(), closing = f.relay.onModuleDestroy();
  const activeRefusal = assert.rejects(active, error => error === failure);
  const closeRefusal = assert.rejects(closing, error => error === failure);
  f.dispatcher.release(); await Promise.all([activeRefusal, closeRefusal]);
  assert.equal(f.dispatcher.calls, 1); assert.deepEqual(f.metrics, []);
  assert.deepEqual(f.order, ["worker:start"]);
});

test("a fresh relay instance still dispatches normally after a different instance was stopped", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
  const stopped = fixture(); await stopped.relay.onModuleDestroy();
  const fresh = fixture(), active = fresh.start(); assert.equal(fresh.dispatcher.calls, 1);
  const closing = fresh.relay.onModuleDestroy(); fresh.dispatcher.release(); await flush();
  try { assert.deepEqual(fresh.order, ["worker:start", "worker:closed", "queue:closed"]); }
  finally { t.mock.timers.setTime(60_000); t.mock.timers.tick(1000); await flush(); await Promise.all([active, closing]); }
});

// Additional component cases. The four original test bodies and their fixture
// remain unchanged. Clock doubles here never enter a real PG/Redis runtime.
class StartupReadyDispatcher extends OutboxDispatcher {
  calls = 0;
  completedAt = 0;
  failure?: Error;
  private releaseGate!: () => void;
  private readonly gate = new Promise<void>(resolve => { this.releaseGate = resolve; });
  constructor() { super(new InMemoryOutboxRepository(), new InMemoryDomainEventBus()); }
  override async dispatch(): Promise<void> { this.calls++; await this.gate; if (this.failure) throw this.failure; this.completedAt = 123_000; }
  override getLastCompletedRoundAt(): number { return this.completedAt; }
  release() { this.releaseGate(); }
}
function startupReadinessFixture() {
  const dispatcher = new StartupReadyDispatcher(), observability = new MetricsService();
  const relay = new OutboxBullMqRelay(dispatcher, observability);
  const clients = [{ status: "ready" }, { status: "ready" }, { status: "ready" }];
  let running = true, active: Promise<void> = Promise.resolve();
  Reflect.set(relay, "queueClient", clients[0]); Reflect.set(relay, "workerClient", clients[1]); Reflect.set(relay, "blockingClient", clients[2]);
  Reflect.set(relay, "worker", { isRunning: () => running, async close() { await active; } });
  Reflect.set(relay, "queue", { async close() {} });
  const process = Reflect.get(relay, "process"); assert.equal(typeof process, "function");
  const metric = async (name: string) => {
    const gauge = observability.registry.getSingleMetric(name); assert.ok(gauge);
    const value = await gauge.get(); assert.equal(value.values.length, 1); return value.values[0]!.value;
  };
  return { dispatcher, relay, clients, metric, setRunning(value: boolean) { running = value; }, start() { active = Reflect.apply(process, relay, [{}]); return active; } };
}

test("connected clients are not ready before the first real process round completes and stopping clears readiness", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000 });
  const f = startupReadinessFixture(); assert.equal(await f.metric("outbox_relay_ready"), 0);
  const active = f.start(); let closing: Promise<void> | undefined;
  try {
    assert.equal(f.dispatcher.calls, 1); assert.equal(await f.metric("outbox_relay_ready"), 0);
    assert.equal(await f.metric("outbox_relay_last_dispatch_timestamp_seconds"), 0);
    f.dispatcher.release(); await flush();
    assert.equal(await f.metric("outbox_relay_ready"), 1);
    assert.equal(await f.metric("outbox_relay_last_dispatch_timestamp_seconds"), 123);
    closing = f.relay.onModuleDestroy(); assert.equal(await f.metric("outbox_relay_ready"), 0);
  } finally {
    closing ??= f.relay.onModuleDestroy(); f.dispatcher.release(); await flush();
    t.mock.timers.tick(1000); await flush(); await Promise.all([active, closing]);
  }
});

test("a completed first round cannot make disconnected Redis clients or a stopped worker ready", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000 });
  const f = startupReadinessFixture(), active = f.start(); f.dispatcher.release(); await flush();
  try {
    assert.equal(await f.metric("outbox_relay_ready"), 1);
    for (const client of f.clients) {
      client.status = "reconnecting"; assert.equal(await f.metric("outbox_relay_ready"), 0);
      client.status = "ready"; assert.equal(await f.metric("outbox_relay_ready"), 1);
    }
    f.setRunning(false); assert.equal(await f.metric("outbox_relay_ready"), 0);
  } finally {
    const closing = f.relay.onModuleDestroy(); await flush(); t.mock.timers.tick(1000); await flush(); await Promise.all([active, closing]);
  }
});

test("a failed initial process round never advertises readiness or a completed dispatch timestamp", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000 });
  const f = startupReadinessFixture(), failure = new Error("synthetic_initial_dispatch_failed"); f.dispatcher.failure = failure;
  const active = f.start(), rejected = assert.rejects(active, error => error === failure); f.dispatcher.release(); await rejected;
  assert.equal(await f.metric("outbox_relay_ready"), 0);
  assert.equal(await f.metric("outbox_relay_last_dispatch_timestamp_seconds"), 0);
  await assert.rejects(f.relay.onModuleDestroy(), error => error === failure);
});