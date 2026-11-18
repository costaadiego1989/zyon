import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Neo4jGraphAdapter } from "../infrastructure/neo4j-graph.adapter.js";
import { GraphProjectionService } from "./graph-projection.service.js";
import { GraphRagSynchronization } from "./graph-sync.service.js";
import { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";
import { GRAPH_EMBEDDING_ID } from "../domain/graph-embedding-model.js";
import type { MerchantGuideSource, MerchantGuideSourcesPort } from "../domain/merchant-guide-sources.port.js";

async function fixture() {
  const ids = [`qa-cbx-sync-${randomUUID()}`, `qa-cbx-sync-${randomUUID()}`], now = Date.now();
  const graph = new Neo4jGraphAdapter({ enabled: true, merchantIds: ids, uri: "bolt://127.0.0.1:17687", database: "neo4j",
    readUser: "neo4j", readPassword: "cashback-local-graph", writeUser: "neo4j", writePassword: "cashback-local-graph", production: false, timeoutMs: 5000 });
  const tenant = new TenantContextService();
  const projection = new GraphProjectionService(graph, { modelId: GRAPH_EMBEDDING_ID, dimensions: 384, generate: async () => [1, ...Array(383).fill(0)] });
  const runtime = { settings: { enabled: true, merchantIds: ids }, readyFor: (id: string) => ids.includes(id), projection };
  const source = (merchantId: string, active = true): MerchantGuideSource => ({ kind: "merchant_help", merchantId, audience: "merchant", context: "cashback", sourceType: "merchant_guide",
    id: "cashback-use", version: now - 100, active, chunks: active ? [{ id: "use", content: "O cashback segue as regras publicadas da loja." }] : [] });
  const rows = async () => (await graph.withProjection(ids[0]!, tx => tx.run("MATCH (d:ZyonGraphMerchantGuide) WHERE d.merchantId IN $ids RETURN d.merchantId AS merchantId, d.audience AS audience, d.context AS context, d.active AS active ORDER BY merchantId", { ids }))).records.map(r => r.toObject());
  const create = (guides: MerchantGuideSourcesPort, catalogPage = async () => ({ sources: [] })) => new GraphRagSynchronization(runtime,
    { page: catalogPage, read: async () => null }, { list: async () => [], read: async () => null }, { subscribe() {}, publish: async () => {}, handlersFor: () => [] }, tenant, guides);
  return { ids, now, graph, runtime, source, rows, create, tenant, async close() {
    assert.ok(ids.every(id => id.startsWith("qa-cbx-sync-")));
    try { await graph.withProjection(ids[0]!, tx => tx.run("MATCH (n) WHERE n.merchantId IN $ids DETACH DELETE n", { ids })); } finally { await graph.close(); }
  } };
}

test("CBX guide synchronization materializes merchant-only reviewed sources for each ready tenant", async () => {
  const f = await fixture();
  const sync = f.create({ async listMerchantGuides(id) { assert.equal(f.tenant.get()?.merchantId, id); return [f.source(id)]; } });
  try {
    await sync.reconcile();
    assert.deepEqual(await f.rows(), [...f.ids].sort().map(merchantId => ({ merchantId, audience: "merchant", context: "cashback", active: true })));
    const publicRows = await f.graph.withProjection(f.ids[0]!, tx => tx.run("MATCH (d:ZyonGraphDocument) WHERE d.merchantId IN $ids RETURN count(d) AS total", { ids: f.ids }));
    assert.equal(Number(publicRows.records[0]!.toObject().total), 0);
  } finally { await sync.beforeApplicationShutdown(); await f.close(); }
});

test("guide synchronization rejects a foreign source without creating a foreign guide", async () => {
  const f = await fixture(), sync = f.create({ listMerchantGuides: async () => [f.source(f.ids[1]!)] });
  try { await sync.synchronize(f.ids[0]!); assert.deepEqual(await f.rows(), []); }
  finally { await sync.beforeApplicationShutdown(); await f.close(); }
});

test("guide synchronization does not read sources while disabled or after shutdown", async () => {
  const f = await fixture(); let reads = 0;
  const sync = f.create({ async listMerchantGuides(id) { reads++; return [f.source(id)]; } });
  try {
    f.runtime.readyFor = () => false; await sync.synchronize(f.ids[0]!); assert.equal(reads, 0); assert.deepEqual(await f.rows(), []);
    f.runtime.readyFor = () => true; await sync.beforeApplicationShutdown(); await sync.synchronize(f.ids[0]!);
    assert.equal(reads, 0); assert.deepEqual(await f.rows(), []);
  } finally { await sync.beforeApplicationShutdown(); await f.close(); }
});

test("guide synchronization coalesces concurrent work and drains before starting another projection", async () => {
  const f = await fixture(); let release!: () => void, begin!: () => void, reads = 0;
  const waiting = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { begin = resolve; });
  const sync = f.create({ async listMerchantGuides(id) { reads++; begin(); await waiting; return [f.source(id)]; } });
  try {
    const work = sync.synchronize(f.ids[0]!); await started;
    const duplicate = sync.synchronize(f.ids[0]!); let drained = false;
    const shutdown = sync.beforeApplicationShutdown().then(() => { drained = true; });
    await Promise.resolve(); assert.equal(drained, false); assert.equal(reads, 1);
    release(); await Promise.all([work, duplicate, shutdown]);
    assert.equal(drained, true); assert.equal(reads, 1); assert.deepEqual(await f.rows(), []);
  } finally { release(); await sync.beforeApplicationShutdown(); await f.close(); }
});

test("a failed guide enumeration can recover on the next cycle and persist a tombstone", async () => {
  const f = await fixture(); let fail = true, active = true;
  const sync = f.create({ async listMerchantGuides(id) { if (fail) throw Error("local fixture unavailable"); return [{ ...f.source(id, active), version: active ? f.now - 100 : f.now }]; } });
  try {
    await sync.synchronize(f.ids[0]!); assert.deepEqual(await f.rows(), []);
    fail = false; await sync.synchronize(f.ids[0]!); assert.deepEqual(await f.rows(), [{ merchantId: f.ids[0], audience: "merchant", context: "cashback", active: true }]);
    active = false; await sync.synchronize(f.ids[0]!); assert.deepEqual(await f.rows(), [{ merchantId: f.ids[0], audience: "merchant", context: "cashback", active: false }]);
  } finally { await sync.beforeApplicationShutdown(); await f.close(); }
});
