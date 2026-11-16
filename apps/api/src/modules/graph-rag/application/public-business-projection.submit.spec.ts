import assert from "node:assert/strict";
import test from "node:test";
import { PublicBusinessProjectionService, type PreparedPublicBusinessProjection } from "./public-business-projection.service.js";
import type { GraphProjectionTransactions, GraphTransaction } from "../domain/graph-rag.port.js";

const prepared = (): PreparedPublicBusinessProjection => ({ merchantId: "tenant-public", sourceType: "company",
  sourceId: "tenant-public", sourceHash: "a".repeat(64), publicRevision: 7, active: true,
  modelId: "synthetic-model-v1", dimensions: 384,
  chunks: [{ id: "b".repeat(64), contentHash: "c".repeat(64), normalizedText: "public company introduction",
    embedding: Array.from({ length: 384 }, (_, index) => index === 0 ? 1 : 0) }] });
const unusedEmbeddings = { modelId: "synthetic-model-v1", dimensions: 384,
  generate: async () => { throw new Error("submission_must_use_prepared_values"); } };
const using = (run: GraphTransaction["run"], capture?: (id: string) => void): GraphProjectionTransactions => ({
  withProjection: async (id, work) => { capture?.(id);return work({ run }); },
});

test("T104", async t => {
  await t.test("an admitted projection preserves the exact prepared public parameters and result", async () => {
    let captured: unknown, merchant: unknown;
    const graph = using(async (_query, parameters) => {
      captured = parameters;return { records: [{ toObject: () => ({ admitted: true }) }] };
    }, id => { merchant = id; });
    const input = prepared(), before = structuredClone(input);
    const result = await new PublicBusinessProjectionService(graph, unusedEmbeddings, () => 1234).submit(input);
    assert.deepEqual(result, { status: "applied" });assert.equal(merchant, input.merchantId);
    assert.deepEqual(captured, { ...before, projectedAt: 1234 });assert.deepEqual(input, before);
  });
  await t.test("a stale revision stays ignored rather than being called published", async () => {
    const graph = using(async () => ({ records: [] }));
    assert.deepEqual(await new PublicBusinessProjectionService(graph, unusedEmbeddings).submit(prepared()), { status: "ignored" });
  });
  await t.test("withdrawal preserves its revision and tombstone without generating embeddings", async () => {
    const input = { ...prepared(), active: false, chunks: [] };let captured: unknown;
    const graph = using(async (_query, parameters) => {
      captured = parameters;return { records: [{ toObject: () => ({ admitted: true }) }] };
    });
    assert.deepEqual(await new PublicBusinessProjectionService(graph, unusedEmbeddings, () => 500).submit(input), { status: "applied" });
    assert.deepEqual(captured, { ...input, projectedAt: 500 });assert.equal(input.publicRevision, 7);
  });
  await t.test("an actual transaction rejection stays unavailable without exposing the private error", async () => {
    const graph = { withProjection: async () => { throw new Error("SYNTHETIC-PRIVATE-DRIVER-DETAIL"); } };
    const result = await new PublicBusinessProjectionService(graph, unusedEmbeddings).submit(prepared());
    assert.deepEqual(result, { status: "unavailable", reason: "graph_unavailable" });
    assert.equal(JSON.stringify(result).includes("SYNTHETIC-PRIVATE-DRIVER-DETAIL"), false);
  });
});
