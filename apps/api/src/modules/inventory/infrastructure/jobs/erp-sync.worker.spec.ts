import assert from "node:assert/strict";
import test from "node:test";
import { ErpSyncWorker } from "./erp-sync.worker.js";

test("ERP restarts reconcile immediately and retain wall-clock periodic boundaries", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setInterval"], now: new Date("2026-09-14T02:29:00.000Z") });
  let periodic = 0;
  const worker = new ErpSyncWorker({ enqueuePeriodic: async () => { periodic += 1; }, drain: async () => {} } as never);
  worker.onModuleInit();
  assert.equal(periodic, 1);
  t.mock.timers.tick(60_000);
  assert.equal(periodic, 2, "the 02:30 boundary must survive a restart at 02:29");
  t.mock.timers.tick(60_000);
  assert.equal(periodic, 2, "do not enqueue a new periodic job every minute");
  worker.onModuleDestroy();
  t.mock.timers.tick(15 * 60_000);
  assert.equal(periodic, 2);
});
