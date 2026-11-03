import test from "node:test";
import assert from "node:assert/strict";
import { GraphRetrievalService } from "./graph-retrieval.service.js";
import { GraphLocalEmbeddingService } from "../infrastructure/graph-local-embedding.service.js";
import type { GraphReadInput } from "../domain/graph-query.js";
import type { GraphCatalogHit } from "../domain/graph-rag.port.js";

const now = 1_790_000_000_000, vector = [1, ...Array(383).fill(0)];
const hit: GraphCatalogHit = { merchantId: "a", productId: "p", variantId: "v", modelId: "model-v1", sourceVersion: now,
  projectedAt: now, sourceHash: "a".repeat(64), vectorScore: 0.9, score: 0.8 };
const config = { enabled: true, merchantIds: ["a"], timeoutMs: 100, maxAgeMs: 300_000, threshold: 0.65 };

test("RAG04 scoped vectors", async () => {
  const reads: GraphReadInput[] = [];
  const service = new GraphRetrievalService(config, { modelId: "model-v1", dimensions: 384, generate: async () => vector },
    { read: async input => { reads.push(input);return { status: "ready", kind: "catalog", partial: true, hits: [hit] }; } }, () => now);
  const result = await service.searchCatalog({ merchantId: "a", query: "restaurar a barreira da pele", limit: 3,
    attributes: [{ name: "perfume", value: "sim", operator: "not_equals" }] });
  assert.deepEqual(result, { status: "ready", hits: [hit], partial: true });
  assert.deepEqual(reads[0], { kind: "catalog", merchantId: "a", query: "restaurar a barreira da pele", limit: 3,
    attributes: [{ name: "perfume", value: "sim", operator: "not_equals" }], embedding: vector,
    modelId: "model-v1", nowEpochMs: now, maxAgeMs: 300_000, threshold: 0.65 });
});

test("RAG04 no synthetic vectors", async () => {
  const service = new GraphRetrievalService(config, { modelId: "model-v1", dimensions: 384, generate: async () => null },
    { read: async () => { throw Error("no graph read without actual embedding"); } }, () => now);
  assert.deepEqual(await service.searchCatalog({ merchantId: "a", query: "pele" }), { status: "unavailable", reason: "embedding_unavailable" });
  const local = new GraphLocalEmbeddingService(async () => { throw Error("model unavailable"); });
  assert.equal(await local.generate("pele"), null);
});

test("disabled or unlisted retrieval performs neither model inference nor graph access", async () => {
  const embeddings = { modelId: "model-v1", dimensions: 384, generate: async () => { throw Error("must not embed"); } };
  const graph = { read: async () => { throw Error("must not read"); } };
  const disabled = new GraphRetrievalService({ ...config, enabled: false }, embeddings, graph);
  assert.deepEqual(await disabled.searchCatalog({ merchantId: "a", query: "pele" }), { status: "unavailable", reason: "disabled" });
  const enabled = new GraphRetrievalService(config, embeddings, graph);
  assert.deepEqual(await enabled.searchCatalog({ merchantId: "b", query: "pele" }), { status: "unavailable", reason: "disabled" });
});

test("retrieval deadline returns unavailable without waiting indefinitely", async () => {
  const service = new GraphRetrievalService({ ...config, timeoutMs: 5 }, { modelId: "model-v1", dimensions: 384,
    generate: async () => new Promise(() => {}) }, { read: async () => { throw Error("not reached"); } });
  assert.deepEqual(await service.searchKnowledge({ merchantId: "a", query: "trocas" }), { status: "unavailable", reason: "timeout" });
});

test("local embeddings cache by model and text and protect cached vectors from caller mutation", async () => {
  let loads = 0, inferences = 0;
  const service = new GraphLocalEmbeddingService(async () => { loads++;return async () => { inferences++;return [...vector]; }; });
  const [first, second] = await Promise.all([service.generate("pele"), service.generate("pele")]);
  assert.deepEqual(first, vector);assert.deepEqual(second, vector);
  first![0] = 0;
  assert.deepEqual(await service.generate("pele"), vector);
  assert.equal(loads, 1);assert.equal(inferences, 1);
  assert.equal(service.dimensions, 384);
  assert.match(service.modelId, /2c4055b12046f11709e9df2c122e59ffbdc2f900/);
});
