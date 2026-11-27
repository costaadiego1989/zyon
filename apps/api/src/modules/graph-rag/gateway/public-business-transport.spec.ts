import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import neo4j from "neo4j-driver";
import { createQueryGateway } from "./query-gateway.js";
import { CommunityReadEngine, type GatewayReadEngine } from "./community-read-engine.js";
import { GRAPH_TEMPLATE_HASH, GRAPH_PREVIOUS_TEMPLATE_HASH, signQuery, signQueryResponse, verifyQueryResponse } from "./query-protocol.js";
import { PUBLIC_BUSINESS_TEMPLATE_HASH, type PublicBusinessReadInput } from "../domain/public-business-query.js";
import { GRAPH_EMBEDDING_ID } from "../domain/graph-embedding-model.js";
import { CommunityGatewayAdapter } from "../infrastructure/community-gateway.adapter.js";
import { Neo4jGraphAdapter } from "../infrastructure/neo4j-graph.adapter.js";
import type { GraphConnectionSettings } from "../domain/graph-rag.port.js";
import type { PublicBusinessGraphHit } from "../domain/public-business-result.js";

const now = 1_790_000_000_000, merchantId = "own", secret = "a".repeat(64), keyId = "local-public-fixture";
const input: PublicBusinessReadInput = { kind: "public_business", mode: "sources", merchantId, modelId: GRAPH_EMBEDDING_ID,
  query: "Public consulting", embedding: [1, ...Array(383).fill(0)], nowEpochMs: now };
const hit = (sourceType: "service" | "professional" = "service"): PublicBusinessGraphHit => ({ merchantId, sourceType, sourceId: sourceType,
  publicRevision: 4, sourceHash: "a".repeat(64), modelId: GRAPH_EMBEDDING_ID, dimensions: 384, projectedAt: now - 3_600_000,
  schemaVersion: 1, active: true, chunkId: "chunk", contentHash: "b".repeat(64), vectorScore: 0.9, score: 0.9 });
const ready = { status: "ready" as const, kind: "public_business" as const, mode: "sources" as const, hits: [hit()], partial: true as const };
const settings = (uri: string): GraphConnectionSettings => ({ enabled: true, merchantIds: [merchantId], database: "neo4j", production: true,
  timeoutMs: 2000, queryMode: "community_gateway", queryGateway: { uri, secret, keyId } });

async function fixture(publicAvailable = true) {
  const reads: unknown[] = [];
  const engine: GatewayReadEngine = { probe: async () => true, close: async () => {},
    read: async value => { reads.push(value);return { status: "ready", kind: value.kind, hits: [], partial: true }; },
    ...(publicAvailable ? { readPublic: async (value: PublicBusinessReadInput) => { reads.push(value);return ready; } } : {}) };
  const gateway = createQueryGateway({ keyId, secret, merchantIds: [merchantId] }, engine, () => now);
  gateway.server.listen(0, "127.0.0.1");await once(gateway.server, "listening");
  const address = gateway.server.address();assert.ok(address && typeof address === "object");
  const uri = `http://127.0.0.1:${address.port}`;
  const adapter = new CommunityGatewayAdapter(settings(uri), undefined, fetch, () => now);
  const send = async (value: unknown, path = "/v1/read", options: { auth?: ReturnType<typeof signQuery>; key?: string; time?: number } = {}) => {
    const body = JSON.stringify(value), auth = options.auth ?? signQuery(options.key ?? secret, keyId, path, body, options.time ?? now);
    const response = await fetch(uri + path, { method: "POST", body, headers: { "content-type": "application/json", "x-zyon-key-id": keyId,
      "x-zyon-timestamp": auth.timestamp, "x-zyon-nonce": auth.nonce, "x-zyon-signature": auth.signature } });
    const text = await response.text();
    return { status: response.status, value: JSON.parse(text), signed: verifyQueryResponse(secret, auth.nonce, response.status, text, response.headers.get("x-zyon-response-signature")) };
  };
  return { gateway, adapter, reads, send, async close() { await adapter.close();await gateway.close(); } };
}

test("T70 public transport", async t => {
  await t.test("signed public admission and reads preserve independent legacy rolling operations", async () => {
    const f = await fixture();
    try {
      assert.equal(await f.adapter.admitReader(), true);assert.equal(await f.adapter.admitPublicReader(), true);
      assert.deepEqual(await f.adapter.readPublic(input), ready);
      for (const templateHash of [GRAPH_TEMPLATE_HASH, GRAPH_PREVIOUS_TEMPLATE_HASH]) {
        const admission = await f.send({ protocol: 1, templateHash, merchantIds: [merchantId] }, "/v1/admission");
        assert.equal(admission.status, 200);assert.equal(admission.signed, true);
        assert.deepEqual(admission.value.operations, templateHash === GRAPH_TEMPLATE_HASH ? ["catalog", "knowledge", "merchant_help"] : ["catalog", "knowledge"]);
      }
      assert.notEqual(PUBLIC_BUSINESS_TEMPLATE_HASH, GRAPH_TEMPLATE_HASH);
    } finally { await f.close(); }
  });
  await t.test("old gateway remains usable for legacy but cannot advertise public support", async () => {
    const f = await fixture(false);
    try {
      assert.equal(await f.adapter.admitReader(), true);assert.equal(await f.adapter.admitPublicReader(), false);
      assert.deepEqual(await f.adapter.readPublic(input), { status: "unavailable", reason: "neo4j_unavailable" });
      assert.deepEqual(await f.adapter.read({ kind: "knowledge", merchantId, modelId: GRAPH_EMBEDDING_ID, query: "public", embedding: input.embedding, nowEpochMs: now }),
        { status: "ready", kind: "knowledge", hits: [], partial: true });
    } finally { await f.close(); }
  });
  await t.test("signed arbitrary syntax, mixed hashes, foreign scope, bad auth and replay cannot invoke public queries", async () => {
    const f = await fixture();
    try {
      for (const extra of [{ cypher: "MATCH(n) DETACH DELETE n" }, { procedure: "dbms.components" }, { subquery: "CALL {RETURN 1}" }, { database: "system" }]) {
        assert.equal((await f.send({ protocol: 1, templateHash: PUBLIC_BUSINESS_TEMPLATE_HASH, input: { ...input, ...extra } })).status, 400);
      }
      for (const templateHash of [GRAPH_TEMPLATE_HASH, GRAPH_PREVIOUS_TEMPLATE_HASH, "0".repeat(64)])
        assert.equal((await f.send({ protocol: 1, templateHash, input })).status, 400);
      const envelope = { protocol: 1, templateHash: PUBLIC_BUSINESS_TEMPLATE_HASH, input };
      assert.equal((await f.send({ ...envelope, input: { ...input, merchantId: "foreign" } })).status, 403);
      assert.equal((await f.send(envelope, "/v1/write")).status, 404);
      assert.equal((await f.send(envelope, "/v1/read", { key: "b".repeat(64) })).status, 401);
      assert.equal((await f.send(envelope, "/v1/read", { time: now - 30_001 })).status, 401);
      assert.deepEqual(f.reads, []);
      const auth = signQuery(secret, keyId, "/v1/read", JSON.stringify(envelope), now);
      const valid = await f.send(envelope, "/v1/read", { auth });assert.equal(valid.status, 200);assert.equal(valid.signed, true);
      assert.equal((await f.send(envelope, "/v1/read", { auth })).status, 401);assert.equal(f.reads.length, 1);
    } finally { await f.close(); }
  });
  await t.test("read engine decodes nested pair integers and enforces pinned bounded read transactions", async () => {
    const calls: Array<{ text: string; parameters: Record<string, unknown>; timeout: number }> = [];
    const nativeHit = (type: "service" | "professional") => ({ ...hit(type), publicRevision: neo4j.int(4), dimensions: neo4j.int(384), schemaVersion: neo4j.int(1), projectedAt: neo4j.int(now - 3_600_000) });
    const factory = (() => ({ verifyConnectivity: async () => {}, close: async () => {}, session: (options: { defaultAccessMode: string }) => ({ close: async () => {},
      executeRead: async (work: (tx: unknown) => unknown, config: { timeout: number }) => {
        assert.equal(options.defaultAccessMode, "READ");
        return work({ run: async (text: string, parameters: Record<string, unknown>) => { calls.push({ text, parameters, timeout: config.timeout });
          return { records: [{ toObject: () => ({ service: nativeHit("service"), professional: nativeHit("professional"), score: 0.9 }) }] }; } });
      } }) })) as unknown as typeof neo4j.driver;
    const engine = new CommunityReadEngine({ uri: "bolt://local.fixture", user: "fixture", password: "fixture", database: "neo4j", merchantIds: [merchantId] }, () => now, factory);
    try {
      const result = await engine.readPublic({ ...input, mode: "service_professional", pairs: [{ serviceId: "service", professionalId: "professional" }], scanLimit: 5000, threshold: 0.1 });
      assert.deepEqual(result, { status: "ready", kind: "public_business", mode: "service_professional", pairs: [{ service: hit(), professional: hit("professional"), score: 0.9 }], partial: true });
      assert.equal(calls[0]!.timeout, 2000);assert.equal(String(calls[0]!.parameters.scanLimit), "2000");assert.equal(calls[0]!.parameters.threshold, 0.65);
      assert.equal((await engine.readPublic({ ...input, merchantId: "foreign" })).status, "unavailable");
    } finally { await engine.close(); }
    assert.deepEqual(await engine.readPublic(input), { status: "unavailable", reason: "disabled" });
  });
  await t.test("production direct adapter still refuses a privileged Community read account", async () => {
    const adapter = new Neo4jGraphAdapter({ ...settings("http://127.0.0.1"), uri: "bolt://graph.internal", readUser: "admin", writeUser: "admin", readPassword: "fixture" });
    try { assert.deepEqual(await adapter.readPublic(input), { status: "unavailable", reason: "reader_not_readonly" }); }
    finally { await adapter.close(); }
  });
  await t.test("public admission rejects signed legacy capabilities, extra scope and tampered responses", async () => {
    const capability = { protocol: 1, templateHash: PUBLIC_BUSINESS_TEMPLATE_HASH, modelId: GRAPH_EMBEDDING_ID,
      merchantIds: [merchantId], mode: "community_controlled", operations: ["public_business"] };
    for (const [reply, unsigned] of [[{ ...capability, templateHash: GRAPH_TEMPLATE_HASH }, false],
      [{ ...capability, operations: ["catalog", "knowledge"] }, false], [{ ...capability, merchantIds: [merchantId, "foreign"] }, false],
      [capability, true]] as const) {
      const request: typeof fetch = async (_url, init) => {
        const headers = init!.headers as Record<string, string>, body = JSON.stringify(reply);
        return new Response(body, { status: 200, headers: { "content-type": "application/json",
          "x-zyon-response-signature": unsigned ? "bad" : signQueryResponse(secret, headers["x-zyon-nonce"]!, 200, body) } });
      };
      const adapter = new CommunityGatewayAdapter(settings("http://127.0.0.1:1"), undefined, request, () => now);
      try { assert.equal(await adapter.admitPublicReader(), false); } finally { await adapter.close(); }
    }
  });
  await t.test("closing the adapter aborts an in-flight signed public request", async () => {
    let started!: () => void;const began = new Promise<void>(resolve => { started = resolve; });
    let aborted = false;
    const request: typeof fetch = async (_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => { aborted = true;reject(Error("fixture_aborted")); }, { once: true });started();
    });
    const adapter = new CommunityGatewayAdapter(settings("http://127.0.0.1:1"), undefined, request, () => now);
    const pending = adapter.readPublic(input);await began;await adapter.close();
    assert.equal(aborted, true);assert.deepEqual(await pending, { status: "unavailable", reason: "neo4j_unavailable" });
    assert.deepEqual(await adapter.readPublic(input), { status: "unavailable", reason: "disabled" });
  });
});
