import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createQueryGateway } from "./query-gateway.js";
import { signQuery, verifyQueryResponse, GRAPH_TEMPLATE_HASH, GRAPH_PREVIOUS_TEMPLATE_HASH } from "./query-protocol.js";
import { GRAPH_EMBEDDING_ID } from "../domain/graph-embedding-model.js";

const secret = "a".repeat(64), keyId = "athom-v1", now = 1_790_000_000_000;
const input = { kind: "catalog", merchantId: "shop-a", query: "pele", modelId: GRAPH_EMBEDDING_ID,
  embedding: [1, ...Array(383).fill(0)], nowEpochMs: now };
const envelope = (input: unknown) => ({ protocol: 1, templateHash: GRAPH_TEMPLATE_HASH, input });

test("GRAPH-03 rolling releases admit only the current and pinned previous template; old clients cannot supply new predicates", async () => {
  const f = await fixture();
  try {
    for (const templateHash of [GRAPH_TEMPLATE_HASH, GRAPH_PREVIOUS_TEMPLATE_HASH]) {
      const admitted = await f.request({ protocol: 1, templateHash, merchantIds: ["shop-a"] }, { path: "/v1/admission" });
      assert.equal(admitted.status, 200); assert.equal(JSON.parse(admitted.text).templateHash, templateHash);
      const result = await f.request(input, { raw: JSON.stringify({ protocol: 1, templateHash, input }) });
      assert.equal(result.status, 200); assert.equal(verifyQueryResponse(secret, result.auth.nonce, 200, result.text, result.signature), true);
    }
    const before = f.reads.length;
    const alternatives = [[{ name: "cor", value: "azul", operator: "equals" }]];
    const oldWithNew = await f.request(input, { raw: JSON.stringify({ protocol: 1, templateHash: GRAPH_PREVIOUS_TEMPLATE_HASH,
      input: { ...input, attributeAnyOf: alternatives } }) });
    assert.equal(oldWithNew.status, 400); assert.equal(f.reads.length, before);
    const current = await f.request({ ...input, attributeAnyOf: alternatives }); assert.equal(current.status, 200);
    assert.deepEqual(f.reads.at(-1).attributeAnyOf, alternatives);
    const unknown = await f.request(input, { raw: JSON.stringify({ protocol: 1, templateHash: "0".repeat(64), input }) });
    assert.equal(unknown.status, 400);
  } finally { await f.gateway.close(); }
});
async function fixture() {
  const reads: any[] = [];let probes = 0, closes = 0;
  const gateway = createQueryGateway({ secret, keyId, merchantIds: ["shop-a"] }, { probe: async () => { probes++;return true; },
    read: async args => { reads.push(args);return { status: "ready", kind: args.kind, hits: [], partial: true }; }, close: async () => { closes++; } }, () => now);
  gateway.server.listen(0, "127.0.0.1");await once(gateway.server, "listening");
  const address = gateway.server.address() as any, base = `http://127.0.0.1:${address.port}`;
  const request = async (value: unknown, options: { path?: string; key?: string; time?: number; headers?: any; raw?: string } = {}) => {
    const path = options.path ?? "/v1/read", body = options.raw ?? JSON.stringify(path === "/v1/read" ? envelope(value) : value);
    const auth = options.headers ?? signQuery(options.key ?? secret, keyId, path, body, options.time ?? now);
    const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json", "x-zyon-key-id": auth.keyId,
      "x-zyon-timestamp": auth.timestamp, "x-zyon-nonce": auth.nonce, "x-zyon-signature": auth.signature }, body });
    const text = await response.text();
    return { status: response.status, text, auth, signature: response.headers.get("x-zyon-response-signature") };
  };
  return { gateway, base, reads, request, probes: () => probes, closes: () => closes };
}
test("GW01 authentic typed reads return nonce-bound signed responses", async () => {
  const f = await fixture();
  try {
    const result = await f.request(input);assert.equal(result.status, 200);
    assert.equal(verifyQueryResponse(secret, result.auth.nonce, 200, result.text, result.signature), true);
    assert.equal(verifyQueryResponse(secret, "wrong", 200, result.text, result.signature), false);
    assert.equal(verifyQueryResponse(secret, result.auth.nonce, 500, result.text, result.signature), false);
    assert.deepEqual(f.reads[0].merchantId, "shop-a");
    const admitted = await f.request({ protocol: 1, templateHash: GRAPH_TEMPLATE_HASH, merchantIds: ["shop-a"] }, { path: "/v1/admission" });
    assert.equal(admitted.status, 200);assert.equal(JSON.parse(admitted.text).mode, "community_controlled");
  } finally { await f.gateway.close(); }
  assert.equal(f.closes(), 1);
});
test("GW01 rejects tamper stale replay foreign unknown-field and write requests before graph reads", async () => {
  const f = await fixture();
  try {
    for (const [value, options, status] of [
      [input, { key: "b".repeat(64) }, 401], [input, { time: now - 30_001 }, 401],
      [{ ...input, merchantId: "shop-b" }, {}, 403], [{ ...input, cypher: "MATCH (n) DELETE n" }, {}, 400],
      [{ ...input, modelId: "wrong-model" }, {}, 400], [input, { path: "/v1/write" }, 404],
      [input, { raw: "not-json" }, 400],
    ] as const) { assert.equal((await f.request(value, options)).status, status);assert.equal(f.reads.length, 0); }
    const headers = signQuery(secret, keyId, "/v1/read", JSON.stringify(envelope(input)), now);
    assert.equal((await f.request({ ...input, merchantId: "shop-b" }, { headers })).status, 401);
    assert.equal(f.reads.length, 0);
    assert.equal((await f.request(input, { headers })).status, 200);
    assert.equal((await f.request(input, { headers })).status, 401);assert.equal(f.reads.length, 1);
    const admitted = await f.request({ protocol: 1, templateHash: GRAPH_TEMPLATE_HASH, merchantIds: ["shop-b"] }, { path: "/v1/admission" });
    assert.equal(admitted.status, 403);assert.equal(f.probes(), 0);
  } finally { await f.gateway.close(); }
});
test("GW01 bounded health probes and body rejection do not invoke query execution", async () => {
  const f = await fixture();
  try {
    await Promise.all(Array.from({ length: 10 }, () => fetch(f.base + "/health")));
    assert.equal(f.probes(), 1);assert.equal(f.reads.length, 0);
    const large = await f.request(input, { raw: "x".repeat(128 * 1024 + 1) });
    assert.equal(large.status, 400);assert.equal(f.reads.length, 0);
  } finally { await f.gateway.close(); }
});
