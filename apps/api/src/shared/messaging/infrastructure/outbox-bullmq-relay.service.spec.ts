import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { OutboxBullMqRelay } from "./outbox-bullmq-relay.service.js";
import { OutboxDispatcher } from "../outbox-dispatcher.service.js";
import { InMemoryOutboxRepository } from "./in-memory-outbox.repository.js";
import { InMemoryDomainEventBus } from "../../events/in-memory-domain-event-bus.js";

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
