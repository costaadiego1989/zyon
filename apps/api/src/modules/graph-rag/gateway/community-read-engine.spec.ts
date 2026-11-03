import test from "node:test";
import assert from "node:assert/strict";
import { CommunityReadEngine } from "./community-read-engine.js";
import { GRAPH_EMBEDDING_ID } from "../domain/graph-embedding-model.js";
const now = 1_790_000_000_000, settings = { uri: "bolt://fixture.internal", user: "fixture", password: "fixture", database: "neo4j", merchantIds: ["a"] };
const input = { kind: "catalog" as const, merchantId: "a", query: "pele", modelId: GRAPH_EMBEDDING_ID,
  embedding: [1, ...Array(383).fill(0)], nowEpochMs: now - 1_000_000, maxAgeMs: 3_600_000, scanLimit: 5000, threshold: 0.1 };
const hit = { merchantId: "a", productId: "p", variantId: "v", modelId: GRAPH_EMBEDDING_ID, sourceHash: "a".repeat(64),
  sourceVersion: now - 100, projectedAt: now - 100, vectorScore: 0.9, score: 0.9 };
function fixture(rows = [hit]) {
  const calls: any[] = [];let created = 0, closed = 0;
  const engine = new CommunityReadEngine(settings, () => now, (() => { created++;return {
    verifyConnectivity: async () => true, close: async () => { closed++; }, session: options => ({
      close: async () => {}, executeRead: async (work, config) => {
        assert.equal(options.defaultAccessMode, "READ");assert.equal(config.timeout, 2000);
        return work({ run: async (text, parameters) => { calls.push({ text, parameters });return { records: rows.map(row => ({ toObject: () => row })) }; } });
      },
    }),
  }; }) as any);
  return { engine, calls, created: () => created, closed: () => closed };
}
test("GW02 fixed scoped engine clamps freshness model scan and transaction limits", async () => {
  const f = fixture();const result = await f.engine.read(input);
  assert.equal(result.status, "ready");assert.equal(f.calls.length, 1);
  assert.match(f.calls[0].text, /ZyonGraphHasVariant \{merchantId: \$merchantId\}/);
  assert.equal(f.calls[0].parameters.minProjectedAt, now - 300_000);
  assert.equal(f.calls[0].parameters.scanLimit.toNumber(), 2000);assert.equal(f.calls[0].parameters.threshold, 0.65);
  await f.engine.close();assert.equal(await f.engine.probe(), false);
  assert.equal((await f.engine.read(input)).status, "unavailable");assert.equal(f.created(), 1);assert.equal(f.closed(), 1);
});
test("GW02 rejects foreign models fields and result scope without a broad fallback", async () => {
  const f = fixture();
  for (const value of [{ ...input, merchantId: "other" }, { ...input, modelId: "old-model" }, { ...input, cypher: "DELETE" }])
    assert.equal((await f.engine.read(value)).status, "unavailable");
  assert.equal(f.created(), 0);
  for (const changed of [{ merchantId: "other" }, { modelId: "old-model" }, { projectedAt: now - 300_001 }]) {
    const invalid = fixture([{ ...hit, ...changed }]);assert.equal((await invalid.engine.read(input)).status, "unavailable");
    await invalid.engine.close();
  }
});
