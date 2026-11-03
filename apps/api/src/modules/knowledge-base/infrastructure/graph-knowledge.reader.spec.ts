import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { GraphKnowledgeReader } from "./graph-knowledge.reader.js";
import { PublishedGraphKnowledgeSources } from "./published-graph-knowledge.sources.js";
import { documentProjectionHash } from "../../graph-rag/application/graph-projection.service.js";

const source = { kind: "knowledge", merchantId: "shop-a", id: "returns", sourceType: "policy", version: 123,
  active: true, chunks: [{ id: "chunk-a", content: "Devolucoes em sete dias." }] } as const;
const hit = { merchantId: "shop-a", sourceType: "policy", sourceId: "returns", chunkId: "chunk-a", sourceVersion: 123,
  sourceHash: documentProjectionHash(source), contentHash: createHash("sha256").update(source.chunks[0].content).digest("hex"),
  modelId: "model", projectedAt: 123, vectorScore: 0.9, score: 0.9 };
const input = { merchantId: "shop-a", queryText: "Posso devolver?" };
test("RAG06 canonical public source", async () => {
  let snapshot: unknown = source, candidate = { ...hit }, reads = 0;
  const reader = new GraphKnowledgeReader({ enabledFor: () => true,
    searchKnowledge: async () => ({ status: "ready", hits: [candidate], partial: true }) } as any,
  { read: async (merchant, type, id) => { reads++;assert.equal(merchant, "shop-a");assert.equal(type, "policy");assert.equal(id, "returns");return snapshot; } } as any);
  assert.deepEqual(await reader.search(input), [{ id: "chunk-a", merchantId: "shop-a", sourceType: "policy", sourceId: "returns",
    content: source.chunks[0].content, similarity: 0.9 }]);
  for (const changed of [null, { ...source, active: false, chunks: [] }, { ...source, version: 124 },
    { ...source, merchantId: "shop-b" }, { ...source, chunks: [{ id: "chunk-a", content: "Outro texto" }] }]) {
    snapshot = changed;assert.deepEqual(await reader.search(input), []);
  }
  snapshot = source;candidate = { ...hit, contentHash: "a".repeat(64) };
  assert.deepEqual(await reader.search(input), []);
  const before = reads;candidate = { ...hit, merchantId: "shop-b" };
  assert.deepEqual(await reader.search(input), []);assert.equal(reads, before);
});
test("published knowledge contains only explicit public policy fields and FAQ question/answer", async () => {
  const sources = new PublishedGraphKnowledgeSources({ publicSnapshot: async merchantId => ({ merchantId, version: 123,
    policy: { returns: "Regra publica", privateSecret: "never-index" } as any }) },
  { snapshot: async merchantId => ({ merchantId, version: 124,
    items: [{ id: "q1", question: "Entrega?", answer: "Consulte o CEP", privateSecret: "never-index" } as any] }) });
  const list = await sources.list("shop-a");
  assert.equal(list.length, 6);
  assert.equal(JSON.stringify(list).includes("never-index"), false);
  assert.equal(list.find(s => s.id === "shipping")?.active, false);
  assert.equal(await sources.read("shop-a", "policy", "privateSecret"), null);
  assert.equal(await sources.read("shop-a", "faq", "unpublished-product"), null);
});
test("graph knowledge fails closed when canonical sources or the provider are unavailable", async () => {
  let enabled = false, calls = 0;
  const reader = new GraphKnowledgeReader({ enabledFor: () => enabled, searchKnowledge: async () => { calls++;throw Error("secret"); } } as any, {} as any);
  assert.equal(await reader.search(input), null);assert.equal(calls, 0);
  enabled = true;assert.equal(await reader.search(input), null);
});
