import test from "node:test";
import assert from "node:assert/strict";
import { Neo4jGraphAdapter, type GraphDriverFactory } from "./neo4j-graph.adapter.js";
import type { GraphConnectionSettings } from "../domain/graph-rag.port.js";

const now = 1_790_000_000_000;
const settings: GraphConnectionSettings = { enabled: true, merchantIds: ["a"], uri: "neo4j+s://graph.example", database: "neo4j",
  readUser: "zyon_reader", readPassword: "read-secret", writeUser: "zyon_writer", writePassword: "write-secret", production: true, timeoutMs: 1500 };
const input = { kind: "catalog" as const, merchantId: "a", query: "pele", modelId: "model-v1", embedding: [1, ...Array(383).fill(0)], nowEpochMs: now };
const hit = { merchantId: "a", productId: "p", variantId: "v", sourceVersion: now - 100, sourceHash: "a".repeat(64),
  modelId: "model-v1", projectedAt: now - 10, vectorScore: 0.9, score: 0.85 };

function fixture(roles: string[], rows = [hit], failure = false) {
  const calls: Array<{ user: string; text: string; timeout: number }> = [], closed: string[] = [];
  const factory: GraphDriverFactory = (_uri, user) => ({ session: options => ({
    executeRead: async (work, config) => {
      assert.equal(options.defaultAccessMode, "READ");assert.equal(config.timeout, 1500);
      return work({ run: async text => {
        calls.push({ user, text, timeout: config.timeout });
        if (failure) throw new Error("provider error containing a secret that must not escape");
        return { records: (text.startsWith("SHOW CURRENT USER") ? [{ user, roles }] : rows).map(row => ({ toObject: () => row })) };
      } });
    },
    executeWrite: async work => work({ run: async () => ({ records: [] }) }),
    close: async () => { closed.push(user); },
  }), close: async () => {} });
  return { adapter: new Neo4jGraphAdapter(settings, factory, () => now), calls, closed, factory };
}

test("RAG02 readonly admission", async () => {
  for (const roles of [["admin"], ["reader", "publisher"], [], ["custom_writer", "reader"]]) {
    const f = fixture(roles);const result = await f.adapter.read(input);
    assert.deepEqual(result, { status: "unavailable", reason: "reader_not_readonly" });
    assert.equal(f.calls.filter(c => !c.text.startsWith("SHOW CURRENT USER")).length, 0);
  }
  const valid = fixture(["PUBLIC", "reader"]);
  const result = await valid.adapter.read(input);
  assert.deepEqual(result, { status: "ready", kind: "catalog", hits: [hit], partial: true });
  assert(valid.calls.every(c => c.user === "zyon_reader"));
  assert.equal(valid.closed.length, 2);
  const sameIdentity = new Neo4jGraphAdapter({ ...settings, readUser: "zyon_writer" }, () => { throw Error("must not open connection"); }, () => now);
  assert.deepEqual(await sameIdentity.read(input), { status: "unavailable", reason: "reader_not_readonly" });
});

test("RAG02 invalid results", async () => {
  for (const change of [{ merchantId: "other" }, { modelId: "old-model" }, { projectedAt: now - 300_001 },
    { projectedAt: now + 30_001 }, { score: NaN }, { sourceHash: "invalid" }, { sourceVersion: -1 }, { vectorScore: 1.1 }]) {
    const f = fixture(["reader"], [{ ...hit, ...change }]);
    assert.deepEqual(await f.adapter.read(input), { status: "unavailable", reason: "invalid_result" }, JSON.stringify(change));
  }
  const f = fixture(["reader"], [hit], true);
  assert.deepEqual(await f.adapter.read(input), { status: "unavailable", reason: "neo4j_unavailable" });
});

test("disabled, unlisted and invalid reads do not create a driver", async () => {
  const factory: GraphDriverFactory = () => { throw Error("network must remain unopened"); };
  const disabled = new Neo4jGraphAdapter({ ...settings, enabled: false }, factory, () => now);
  assert.deepEqual(await disabled.read(input), { status: "unavailable", reason: "disabled" });
  const enabled = new Neo4jGraphAdapter(settings, factory, () => now);
  assert.deepEqual(await enabled.read({ ...input, merchantId: "b" }), { status: "unavailable", reason: "disabled" });
  assert.deepEqual(await enabled.read({ ...input, embedding: [] }), { status: "unavailable", reason: "invalid_input" });
});

test("a projection uses the writer identity and cannot execute for an unlisted merchant", async () => {
  const f = fixture(["reader"]);
  const value = await f.adapter.withProjection("a", async tx => { await tx.run("trusted projection");return "projected"; });
  assert.equal(value, "projected");
  assert.deepEqual(f.closed, ["zyon_writer"]);
  await assert.rejects(f.adapter.withProjection("b", async () => "must not run"), /graph_projection_unavailable/);
});
