import assert from "node:assert/strict";
import test from "node:test";
import { GraphRagSynchronization } from "./graph-sync.service.js";
import { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";

test("T66 background indexing retains server tenant scope, keeps source events independent and drains on shutdown", async () => {
  const originalInterval = globalThis.setInterval, originalClear = globalThis.clearInterval;
  const timers: Array<{ delay: number; callback: () => void; cleared: boolean }> = [];
  let release!: () => void, entered!: () => void, stopped = false, indexed = 0, reconciled = 0;
  const hold = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { entered = resolve; });
  const tenant = new TenantContextService(), handlers = new Map<string, (event: { merchantId: string }) => Promise<void>>();
  globalThis.setInterval = ((callback: () => void, delay: number) => {
    const value = { delay, callback, cleared: false, unref() {} };timers.push(value);return value;
  }) as never;
  globalThis.clearInterval = ((value: { cleared: boolean }) => { value.cleared = true; }) as never;
  const runtime = { settings: { enabled: true, merchantIds: ["tenant-a"] }, readyFor: () => true,
    projection: { retireMissingCatalog: async () => {} } };
  const sync = new GraphRagSynchronization(runtime as never, { page: async () => ({ sources: [] }) } as never,
    { list: async () => [] } as never, { subscribe: (event: string, handler: never) => { handlers.set(event, handler); } } as never,
    tenant, { reconcile: async merchantId => {
      assert.equal(merchantId, "tenant-a");assert.deepEqual(tenant.get(), { merchantId: "tenant-a", userId: "public-business-index", role: "system" });
      reconciled++;entered();await hold;
    } }, { runMerchant: async () => { indexed++;return { failed: 0 }; }, stop: async () => { stopped = true; } } as never);
  try {
    sync.onModuleInit();await ready;
    await tenant.run({ merchantId: "tenant-a", userId: "buyer-request", role: "buyer" } as never,
      () => handlers.get("merchant.config_updated")!({ merchantId: "tenant-a" }));
    assert.equal(reconciled, 1);assert.equal(indexed, 0, "the inline customer event must not start or await the held indexing path");
    const shutdown = sync.beforeApplicationShutdown();let closed = false;void shutdown.then(() => { closed = true; });
    await Promise.resolve();assert.equal(stopped, true);assert.equal(closed, false);
    assert.equal(timers.length, 2);assert.ok(timers.every(timer => timer.cleared));
    for (const timer of timers) timer.callback();
    release();await shutdown;assert.equal(closed, true);assert.equal(indexed, 0);assert.equal(reconciled, 1);
  } finally {
    release();await sync.beforeApplicationShutdown();globalThis.setInterval = originalInterval;globalThis.clearInterval = originalClear;
  }
});
