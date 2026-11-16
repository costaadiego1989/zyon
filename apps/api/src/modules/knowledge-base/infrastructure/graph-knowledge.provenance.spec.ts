import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { GraphKnowledgeReader } from "./graph-knowledge.reader.js";
import { GRAPH_EMBEDDING_ID } from "../../graph-rag/domain/graph-embedding-model.js";
import { documentProjectionHash } from "../../graph-rag/application/graph-projection.service.js";

const source = { kind: "knowledge", merchantId: "own", id: "returns", sourceType: "policy", version: 123,
  active: true, chunks: [{ id: "public-chunk", content: "Current public policy." }] } as const;
const hit = { merchantId: "own", sourceType: "policy", sourceId: "returns", sourceVersion: 123,
  sourceHash: documentProjectionHash(source), modelId: GRAPH_EMBEDDING_ID, projectedAt: 456,
  chunkId: "public-chunk", contentHash: createHash("sha256").update(source.chunks[0].content).digest("hex"), vectorScore: 0.9, score: 0.9 };
const input = { merchantId: "own", queryText: "Qual e a politica?" };

test("T69 explicit reader sidecar retains checked retrieval evidence", async t => {
  await t.test("exact graph document revision/hash/model and chunk proof remain distinct from canonical references", async () => {
    const reader = new GraphKnowledgeReader({ enabledFor: () => true,
      searchKnowledge: async () => ({ status: "ready", hits: [{ ...hit }], partial: true }) } as any,
    { read: async () => source } as any);
    const result = await (reader as any).searchWithEvidence(input);
    assert.deepEqual(result.chunks, [{ id: "public-chunk", merchantId: "own", sourceType: "policy", sourceId: "returns", content: source.chunks[0].content, similarity: 0.9 }]);
    assert.deepEqual(result.retrieval, [{ kind: "legacy-graph-retrieval", merchantId: "own", sourceType: "policy", sourceId: "returns",
      sourceVersion: 123, sourceHash: hit.sourceHash, embeddingModel: GRAPH_EMBEDDING_ID, embeddingDimensions: 384,
      chunkId: "public-chunk", contentHash: hit.contentHash, projectedAt: 456 }]);
    assert.deepEqual(await reader.search(input), result.chunks, "legacy search output must keep its exact public shape");
  });
  await t.test("foreign scope and another384 model cannot supply indexed proof", async () => {
    let candidate = { ...hit }, reads = 0;
    const reader = new GraphKnowledgeReader({ enabledFor: () => true,
      searchKnowledge: async () => ({ status: "ready", hits: [candidate], partial: true }) } as any,
    { read: async () => { reads++;return source; } } as any);
    candidate = { ...hit, merchantId: "foreign" };
    assert.deepEqual(await (reader as any).searchWithEvidence(input), { chunks: [], retrieval: [] });
    assert.equal(reads, 0);
    candidate = { ...hit, modelId: "another384model" };
    assert.deepEqual(await (reader as any).searchWithEvidence(input), { chunks: [], retrieval: [] });
    assert.equal(reads, 0);
  });
  await t.test("mutable transport fields are captured before canonical source awaits", async () => {
    let release!: (value: typeof source) => void, entered!: () => void;
    const pending = new Promise<typeof source>(resolve => { release = resolve; });
    const selected = new Promise<void>(resolve => { entered = resolve; });
    const candidate = { ...hit };
    const reader = new GraphKnowledgeReader({ enabledFor: () => true,
      searchKnowledge: async () => ({ status: "ready", hits: [candidate], partial: true }) } as any,
    { read: async () => { entered();return pending; } } as any);
    const reading = (reader as any).searchWithEvidence(input);await selected;
    Object.assign(candidate, { modelId: "changed-after-read", sourceVersion: 999, sourceHash: "changed", merchantId: "foreign" });
    release(source);const result = await reading;
    assert.equal(result.retrieval[0].merchantId, "own");assert.equal(result.retrieval[0].sourceVersion, 123);
    assert.equal(result.retrieval[0].sourceHash, hit.sourceHash);assert.equal(result.retrieval[0].embeddingModel, GRAPH_EMBEDDING_ID);
    assert.equal(result.chunks[0].content, source.chunks[0].content);
  });
});
