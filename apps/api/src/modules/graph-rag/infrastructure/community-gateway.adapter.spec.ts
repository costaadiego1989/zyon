import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { CommunityGatewayAdapter } from "./community-gateway.adapter.js";
import { createQueryGateway } from "../gateway/query-gateway.js";
import { GRAPH_TEMPLATE_HASH, signQueryResponse } from "../gateway/query-protocol.js";
import { GRAPH_EMBEDDING_ID } from "../domain/graph-embedding-model.js";
import { graphRagSettings } from "../graph-rag.settings.js";

const now = 1_790_000_000_000, secret = "a".repeat(64), keyId = "athom-v1";
const input = { kind: "catalog" as const, merchantId: "a", query: "pele", modelId: GRAPH_EMBEDDING_ID,
  embedding: [1, ...Array(383).fill(0)], nowEpochMs: now };
const hit = { merchantId: "a", productId: "p", variantId: "v", sourceHash: "a".repeat(64), sourceVersion: now - 100,
  projectedAt: now - 100, modelId: GRAPH_EMBEDDING_ID, vectorScore: 0.9, score: 0.9 };
const settings = (uri: string) => ({ enabled: true, merchantIds: ["a"], uri: "bolt://private.railway.internal:7687", database: "neo4j",
  writeUser: "indexer", writePassword: "write-fixture", production: false, timeoutMs: 2000,
  queryMode: "community_gateway" as const, queryGateway: { uri, secret, keyId } });

test("GW03 signed private capability and read transport keep the projection identity separate", async () => {
  const reads: unknown[] = [];let writes = 0;
  const server = createQueryGateway({ keyId, secret, merchantIds: ["a"] }, { probe: async () => true,
    read: async args => { reads.push(args);return { status: "ready", kind: "catalog", hits: [hit], partial: true }; }, close: async () => {} }, () => now);
  server.server.listen(0, "127.0.0.1");await once(server.server, "listening");
  const uri = `http://127.0.0.1:${(server.server.address() as any).port}`;
  const adapter = new CommunityGatewayAdapter(settings(uri), { withProjection: async (merchant, work) => {
    assert.equal(merchant, "a");writes++;return work({ run: async () => ({ records: [] }) }); }, close: async () => {} } as any, fetch, () => now);
  try {
    assert.equal(await adapter.admitReader(), true);
    assert.deepEqual(await adapter.read(input), { status: "ready", kind: "catalog", hits: [hit], partial: true });
    assert.equal(reads.length, 1);assert.equal(writes, 0);
    await adapter.withProjection("a", async () => "projected");assert.equal(writes, 1);assert.equal(reads.length, 1);
    assert.equal((await adapter.read({ ...input, merchantId: "other" })).status, "unavailable");assert.equal(reads.length, 1);
    await assert.rejects(adapter.withProjection("other", async () => undefined));
    await adapter.close();assert.equal(await adapter.admitReader(), false);
    assert.equal((await adapter.read(input)).status, "unavailable");assert.equal(reads.length, 1);
  } finally { await adapter.close();await server.close(); }
});
test("GW03 malformed signed capability foreign rows and unsigned responses are not admitted", async () => {
  const capability = { protocol: 1, templateHash: GRAPH_TEMPLATE_HASH, modelId: GRAPH_EMBEDDING_ID, merchantIds: ["a"],
    mode: "community_controlled", operations: ["catalog", "knowledge"] };
  const ready = { status: "ready", kind: "catalog", hits: [hit], partial: true };
  for (const [reply, unsigned, shouldAdmit] of [[capability, false, true], [{ ...capability, templateHash: "wrong" }, false, false],
    [{ ...capability, merchantIds: ["a", "other"] }, false, false], [capability, true, false]] as const) {
    const adapter = new CommunityGatewayAdapter(settings("http://127.0.0.1:1"), { close: async () => {} } as any,
      (async (_url, init) => { const text = JSON.stringify(reply), nonce = (init!.headers as any)["x-zyon-nonce"];
        return new Response(text, { status: 200, headers: { "content-type": "application/json",
          "x-zyon-response-signature": unsigned ? "bad" : signQueryResponse(secret, nonce, 200, text) } }); }) as any, () => now);
    assert.equal(await adapter.admitReader(), shouldAdmit);await adapter.close();
  }
  for (const value of [{ ...ready, hits: [{ ...hit, merchantId: "other" }] }, { ...ready, hits: [{ ...hit, projectedAt: now - 300_001 }] },
    { ...ready, hits: [{ ...hit, modelId: "wrong" }] }, { ...ready, kind: "knowledge" }, { ...ready, extra: "not-admitted" }]) {
    const adapter = new CommunityGatewayAdapter(settings("http://127.0.0.1:1"), { close: async () => {} } as any,
      (async (_url, init) => { const text = JSON.stringify(value);return new Response(text, { status: 200, headers: {
        "content-type": "application/json", "x-zyon-response-signature": signQueryResponse(secret, (init!.headers as any)["x-zyon-nonce"], 200, text),
      } }); }) as any, () => now);
    assert.equal((await adapter.read(input)).status, "unavailable");await adapter.close();
  }
});
test("GW05 disabled adapter opens no HTTP connection and invalid gateway configuration stays off", async () => {
  let calls = 0;
  const adapter = new CommunityGatewayAdapter({ ...settings("http://127.0.0.1:1"), enabled: false }, { close: async () => {} } as any,
    (async () => { calls++;throw Error(); }) as any, () => now);
  assert.equal(await adapter.admitReader(), false);assert.equal((await adapter.read(input)).status, "unavailable");assert.equal(calls, 0);await adapter.close();
  const valid = { NODE_ENV: "production", GRAPH_RAG_ENABLED: "true", GRAPH_RAG_QUERY_MODE: "community_gateway",
    GRAPH_RAG_MERCHANT_IDS: "a", NEO4J_URI: "bolt://neo4j.railway.internal:7687", NEO4J_WRITE_USER: "indexer",
    NEO4J_WRITE_PASSWORD: "fixture", GRAPH_GATEWAY_URL: "http://graph-query.railway.internal:8080", GRAPH_GATEWAY_KEY: secret, GRAPH_GATEWAY_KEY_ID: keyId };
  assert.equal(graphRagSettings(valid).enabled, true);
  for (const patch of [{ GRAPH_GATEWAY_KEY: undefined }, { GRAPH_GATEWAY_URL: "https://external.example" },
    { GRAPH_GATEWAY_URL: "http://user:pass@graph-query.railway.internal:8080" }, { GRAPH_GATEWAY_URL: "http://graph-query.railway.internal:8080?x=1" },
    { GRAPH_RAG_QUERY_MODE: "unknown" }]) assert.equal(graphRagSettings({ ...valid, ...patch }).enabled, false);
});
