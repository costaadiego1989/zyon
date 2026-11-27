import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { Neo4jGraphAdapter } from "./neo4j-graph.adapter.js";
import { CommunityGatewayAdapter } from "./community-gateway.adapter.js";
import { CommunityReadEngine } from "../gateway/community-read-engine.js";
import { createQueryGateway } from "../gateway/query-gateway.js";
import { GraphProjectionService, merchantGuideProjectionHash } from "../application/graph-projection.service.js";
import { GRAPH_EMBEDDING_ID } from "../domain/graph-embedding-model.js";
import { GRAPH_PREVIOUS_TEMPLATE_HASH, signQuery } from "../gateway/query-protocol.js";

const uri = "bolt://127.0.0.1:17687", user = "neo4j", password = "cashback-local-graph";
const embedding = [1, ...Array(383).fill(0)], secret = "c".repeat(64), keyId = "cashback-local";
async function fixture() {
  assert.equal(new URL(uri).hostname, "127.0.0.1");
  const now = Date.now(), prefix = `qa-cbx-${randomUUID()}`, merchantIds = [`${prefix}-a`, `${prefix}-b`];
  const settings = { enabled: true, merchantIds, uri, database: "neo4j", readUser: user, readPassword: password,
    writeUser: user, writePassword: password, production: false, timeoutMs: 5000 };
  const direct = new Neo4jGraphAdapter(settings, undefined, () => now);
  const engine = new CommunityReadEngine({ uri, user, password, database: "neo4j", merchantIds }, () => now);
  assert.equal(await engine.probe(), true, "dedicated loopback Neo4j must be ready; no skip or simulated query");
  const gateway = createQueryGateway({ secret, keyId, merchantIds }, engine, () => now);
  gateway.server.listen(0, "127.0.0.1"); await once(gateway.server, "listening");
  const base = `http://127.0.0.1:${(gateway.server.address() as { port: number }).port}`;
  const remote = new CommunityGatewayAdapter({ ...settings, queryGateway: { uri: base, secret, keyId } }, undefined, fetch, () => now);
  const projector = new GraphProjectionService(direct, { modelId: GRAPH_EMBEDDING_ID, dimensions: 384, generate: async () => [...embedding] }, () => now);
  const guide = (merchantId: string, id = "cashback-use") => ({ kind: "merchant_help" as const, merchantId,
    audience: "merchant" as const, context: "cashback" as const, sourceType: "merchant_guide" as const,
    id, version: now - 1000, active: true, chunks: [{ id: `${id}-main`, content: "Uso cashback depende das regras publicadas da loja." }] });
  const input = { kind: "merchant_help" as const, merchantId: merchantIds[0]!, context: "cashback" as const,
    query: "uso cashback", modelId: GRAPH_EMBEDDING_ID, embedding, nowEpochMs: now, maxAgeMs: 300000, threshold: 0.65 };
  const both = async (value = input) => {
    const a = await direct.read(value), b = await remote.read(value); assert.deepEqual(b, a); return a;
  };
  return { now, merchantIds, guide, input, both, direct, remote, projector, base,
    async close() {
      try {
        assert.ok(merchantIds.every(id => id.startsWith("qa-cbx-")));
        await direct.withProjection(merchantIds[0]!, tx => tx.run("MATCH (n) WHERE n.merchantId IN $merchantIds DETACH DELETE n", { merchantIds }));
      } finally { await remote.close(); await direct.close(); await gateway.close(); }
    } };
}

test("CBX-20 real Cypher and signed gateway return only current scoped merchant cashback guides", async () => {
  const f = await fixture();
  try {
    const source = f.guide(f.merchantIds[0]!);
    assert.equal((await f.projector.projectMerchantGuide(source)).status, "applied");
    assert.equal((await f.projector.projectMerchantGuide(f.guide(f.merchantIds[1]!))).status, "applied");
    assert.equal(await f.remote.admitReader(), true);
    const result = await f.both(); assert.equal(result.status, "ready");
    if (result.status !== "ready") throw Error("ready expected");
    assert.equal(result.kind, "merchant_help"); assert.equal(result.hits.length, 1);
    assert.deepEqual(result.hits[0], { merchantId: source.merchantId, audience: "merchant", context: "cashback",
      sourceType: "merchant_guide", sourceId: source.id, chunkId: source.chunks[0]!.id,
      contentHash: (await import("node:crypto")).createHash("sha256").update(source.chunks[0]!.content).digest("hex"),
      sourceHash: merchantGuideProjectionHash(source), sourceVersion: source.version,
      modelId: GRAPH_EMBEDDING_ID, projectedAt: f.now, vectorScore: 1, score: 1 });
  } finally { await f.close(); }
});
test("real guide query rejects corrupt audience context tenant edges revision hash model and age", async () => {
  const f = await fixture();
  try {
    const patches = ["c.audience = 'buyer'", "c.context = 'meta_ads'", "c.merchantId = $foreign",
      "c.sourceVersion = 0", "c.sourceHash = 'obsolete'", "c.modelId = 'old-model'", "c.projectedAt = 0",
      "r.context = 'meta_ads'", "r.audience = 'buyer'", "r.merchantId = $foreign", "d.active = false"];
    for (const [i, patch] of patches.entries()) {
      const guide = f.guide(f.merchantIds[0]!, `invalid-${i}`);
      assert.equal((await f.projector.projectMerchantGuide(guide)).status, "applied");
      await f.direct.withProjection(guide.merchantId, tx => tx.run(`MATCH (d:ZyonGraphMerchantGuide {merchantId: $merchantId, canonicalId: $id})-[r:ZyonGraphHasGuideChunk]->(c) SET ${patch}`,
        { merchantId: guide.merchantId, id: guide.id, foreign: f.merchantIds[1] }));
    }
    const result = await f.both(); assert.equal(result.status, "ready");
    if (result.status === "ready") assert.deepEqual(result.hits, []);
  } finally { await f.close(); }
});
test("real merchant guide projection cannot enter public buyer FAQ reads", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.projector.projectMerchantGuide(f.guide(f.merchantIds[0]!))).status, "applied");
    const { context: _context, ...input } = f.input;
    const direct = await f.direct.read({ ...input, kind: "knowledge" });
    const gateway = await f.remote.read({ ...input, kind: "knowledge" });
    assert.deepEqual(direct, { status: "ready", kind: "knowledge", hits: [], partial: true }); assert.deepEqual(gateway, direct);
  } finally { await f.close(); }
});
test("real guide tombstone blocks stale replay and removes query eligibility", async () => {
  const f = await fixture();
  try {
    const source = f.guide(f.merchantIds[0]!); await f.projector.projectMerchantGuide(source);
    assert.equal((await f.projector.projectMerchantGuide({ ...source, active: false, version: f.now, chunks: [] })).status, "applied");
    assert.equal((await f.projector.projectMerchantGuide(source)).status, "ignored");
    assert.deepEqual(await f.both(), { status: "ready", kind: "merchant_help", hits: [], partial: true });
    const stored = await f.direct.withProjection(source.merchantId, tx => tx.run("MATCH (c:ZyonGraphMerchantGuideChunk {merchantId: $merchantId}) RETURN c.active AS active, c.embedding AS embedding", { merchantId: source.merchantId }));
    assert.deepEqual(stored.records.map(r => r.toObject()), [{ active: false, embedding: null }]);
  } finally { await f.close(); }
});
test("signed gateway rejects old-template merchant capability and foreign tenant before execution", async () => {
  const f = await fixture();
  try {
    const body = JSON.stringify({ protocol: 1, templateHash: GRAPH_PREVIOUS_TEMPLATE_HASH, input: f.input });
    const auth = signQuery(secret, keyId, "/v1/read", body, f.now);
    const response = await fetch(f.base + "/v1/read", { method: "POST", body, headers: { "content-type": "application/json",
      "x-zyon-key-id": keyId, "x-zyon-timestamp": auth.timestamp, "x-zyon-nonce": auth.nonce, "x-zyon-signature": auth.signature } });
    assert.equal(response.status, 400);
    assert.deepEqual(await f.both({ ...f.input, merchantId: "qa-cbx-unlisted" }), { status: "unavailable", reason: "disabled" });
  } finally { await f.close(); }
});
