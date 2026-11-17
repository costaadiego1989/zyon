import assert from "node:assert/strict";
import test from "node:test";
import { PublicBusinessRetrievalService } from "./public-business-retrieval.service.js";
import { GRAPH_EMBEDDING_ID } from "../domain/graph-embedding-model.js";
import { GraphRagRuntime } from "../graph-rag.module.js";
import { GraphLocalEmbeddingService } from "../infrastructure/graph-local-embedding.service.js";
import type { GraphConnectionSettings, GraphEmbeddingPort, GraphRuntimeAdapter } from "../domain/graph-rag.port.js";
import type { PublicBusinessReadResult } from "../domain/public-business-result.js";

const vector = [1, ...Array(383).fill(0)], base = { enabled: true, merchantIds: ["own"], timeoutMs: 2500, maxAgeMs: 300_000, threshold: 0.65 };
const embeddings: GraphEmbeddingPort = { modelId: GRAPH_EMBEDDING_ID, dimensions: 384, generate: async () => [...vector] };

test("T70 public retrieval", async t => {
  await t.test("validated six-family request uses the pinned local embedding and preserves partial scope", async () => {
    const retrieval = new PublicBusinessRetrievalService(base, embeddings, { readPublic: async input => {
      assert.equal(input.modelId, GRAPH_EMBEDDING_ID);assert.deepEqual(input.embedding, vector);assert.equal(input.merchantId, "own");
      assert.equal(input.mode, "sources");assert.equal(input.threshold, 0.65);
      return { status: "ready", kind: "public_business", mode: "sources", hits: [], partial: true };
    } });
    assert.deepEqual(await retrieval.search({ mode: "sources", merchantId: "own", query: "Public question" }),
      { status: "ready", kind: "public_business", mode: "sources", hits: [], partial: true });
  });
  await t.test("invalid scope, model, vector and extra syntax cannot produce graph evidence", async () => {
    const forbidden = { readPublic: async () => { throw Error("graph_must_not_run"); } };
    const retrieval = new PublicBusinessRetrievalService(base, embeddings, forbidden);
    assert.deepEqual(await retrieval.search({ mode: "sources", merchantId: "foreign", query: "Public question" }), { status: "unavailable", reason: "disabled" });
    assert.deepEqual(await retrieval.search({ mode: "sources", merchantId: "own", query: "Public question", cypher: "DELETE" } as never), { status: "unavailable", reason: "invalid_input" });
    for (const override of [{ modelId: "wrong-model-384" }, { dimensions: 768 }, { generate: async () => Array(384).fill(0) }]) {
      const invalid = new PublicBusinessRetrievalService(base, { ...embeddings, ...override }, forbidden);
      assert.deepEqual(await invalid.search({ mode: "sources", merchantId: "own", query: "Public question" }), { status: "unavailable", reason: "embedding_unavailable" });
    }
  });
  await t.test("the caller deadline rejects a held graph reply and a late success cannot replace that result", { timeout: 5000 }, async () => {
    let started!: () => void, finish!: (value: PublicBusinessReadResult) => void;
    const began = new Promise<void>(resolve => { started = resolve; });
    const held = new Promise<PublicBusinessReadResult>(resolve => { finish = resolve; });
    const retrieval = new PublicBusinessRetrievalService({ ...base, timeoutMs: 20 }, embeddings,
      { readPublic: async () => { started();return held; } });
    const pending = retrieval.search({ mode: "sources", merchantId: "own", query: "Public question" });
    try {
      await began;
      assert.deepEqual(await pending, { status: "unavailable", reason: "timeout" });
      finish({ status: "ready", kind: "public_business", mode: "sources", hits: [], partial: true });
      await held;
      assert.deepEqual(await pending, { status: "unavailable", reason: "timeout" });
    } finally { finish({ status: "unavailable", reason: "disabled" }); }
  });
  await t.test("legacy admission does not grant the new capability or disable legacy reads", async () => {
    const adapter: GraphRuntimeAdapter = { admitReader: async () => true, close: async () => {}, withProjection: async () => { throw Error("not_a_writer_test"); },
      read: async input => ({ status: "ready", kind: input.kind, hits: [], partial: true }) };
    const settings: GraphConnectionSettings = { enabled: true, merchantIds: ["own"], database: "neo4j", production: false, timeoutMs: 2000 };
    const runtime = new GraphRagRuntime(settings, adapter, new GraphLocalEmbeddingService(async () => async () => [...vector]));
    try {
      await runtime.onModuleInit();assert.equal(runtime.readyFor("own"), true);assert.equal(runtime.publicReadyFor("own"), false);
      assert.deepEqual(await runtime.searchPublicBusiness({ mode: "sources", merchantId: "own", query: "Public question" }), { status: "unavailable", reason: "disabled" });
      assert.deepEqual(await runtime.searchKnowledge({ merchantId: "own", query: "Public question" }), { status: "ready", hits: [], partial: true });
    } finally { await runtime.onApplicationShutdown(); }
    assert.equal(runtime.publicReadyFor("own"), false);assert.equal(runtime.readyFor("own"), false);
  });
  await t.test("runtime exposes public reads only after independent admission and stops them on shutdown", async () => {
    let closed = false;
    const adapter: GraphRuntimeAdapter = { admitReader: async () => true, admitPublicReader: async () => true,
      close: async () => { closed = true; }, withProjection: async () => { throw Error("not_a_writer_test"); },
      read: async input => ({ status: "ready", kind: input.kind, hits: [], partial: true }),
      readPublic: async () => ({ status: "ready", kind: "public_business", mode: "sources", hits: [], partial: true }) };
    const settings: GraphConnectionSettings = { enabled: true, merchantIds: ["own"], database: "neo4j", production: false, timeoutMs: 2000 };
    const runtime = new GraphRagRuntime(settings, adapter, new GraphLocalEmbeddingService(async () => async () => [...vector]));
    await runtime.onModuleInit();assert.equal(runtime.publicReadyFor("own"), true);assert.equal(runtime.publicReadyFor("foreign"), false);
    assert.deepEqual(await runtime.searchPublicBusiness({ mode: "sources", merchantId: "own", query: "Public question" }),
      { status: "ready", kind: "public_business", mode: "sources", hits: [], partial: true });
    await runtime.onApplicationShutdown();assert.equal(closed, true);
    assert.deepEqual(await runtime.searchPublicBusiness({ mode: "sources", merchantId: "own", query: "Public question" }), { status: "unavailable", reason: "disabled" });
  });
});
