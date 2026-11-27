import assert from "node:assert/strict";
import { test } from "node:test";
import { PrismaMetaAdsRepository } from "./prisma-meta-ads.repository.js";
import { testDatabase } from "./__tests__/database.js";

test("durable repository serializes concurrent store mutations and survives a new instance", async () => {
  const db = await testDatabase();
  try {
    const repo = new PrismaMetaAdsRepository(db.prisma);
    assert.equal((await repo.read("store-a")).credits.extraAvailable, 0);
    await Promise.all(Array.from({ length: 20 }, (_, i) => repo.mutate("store-a", [], state => {
      state.credits.extraAvailable += 1;
      return { result: i, records: [{ key: `event:${i}`, kind: "audit", payload: { value: i }, createdAt: "2026-11-14T12:00:00Z" }] };
    })));
    const restarted = new PrismaMetaAdsRepository(db.prisma);
    assert.equal((await restarted.read("store-a")).credits.extraAvailable, 20);
    assert.equal((await restarted.listRecords("store-a", "audit")).length, 20);
    assert.equal((await restarted.read("store-b")).credits.extraAvailable, 0);
    assert.equal(await restarted.getRecord("store-b", "event:1"), null);
    assert.deepEqual((await restarted.getRecord("store-a", "event:1"))?.payload, { value: 1 });
    assert.deepEqual(await restarted.listStoreIds(10), ["store-a"]);
  } finally { await db.close(); }
});

test("durable repository atomically rolls back errors and duplicate receipts", async () => {
  const db = await testDatabase();
  try {
    const repo = new PrismaMetaAdsRepository(db.prisma);
    await repo.mutate("store-a", [], state => { state.credits.extraAvailable = 4; return { result: null, records: [{ key: "once", kind: "audit", payload: { ok: true }, createdAt: new Date().toISOString() }] }; });
    await assert.rejects(repo.mutate("store-a", [], state => { state.credits.extraAvailable = 99; throw new Error("rollback"); }), /rollback/);
    await assert.rejects(repo.mutate("store-a", [], state => { state.credits.extraAvailable = 100; return { result: null, records: [{ key: "once", kind: "audit", payload: {}, createdAt: new Date().toISOString() }] }; }));
    assert.equal((await repo.read("store-a")).credits.extraAvailable, 4);
    const existing = await repo.mutate("store-a", ["once"], (_state, records) => ({ result: records.get("once")?.payload }));
    assert.deepEqual(existing, { ok: true });
    await assert.rejects(repo.mutate("store-a", [], state => { state.merchantId = "store-b"; return { result: null }; }), /tenant_state_invalid/);
    assert.equal((await repo.read("store-a")).merchantId, "store-a");
    await assert.rejects(repo.read("../store-a"), /invalid_identifier/);
  } finally { await db.close(); }
});
