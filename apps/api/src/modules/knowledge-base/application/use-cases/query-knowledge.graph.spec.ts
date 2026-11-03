import test from "node:test";
import assert from "node:assert/strict";
import { QueryKnowledgeUseCase } from "./query-knowledge.use-case.js";
import { GraphKnowledgeReader } from "../../infrastructure/graph-knowledge.reader.js";
import { PublishedGraphKnowledgeSources } from "../../infrastructure/published-graph-knowledge.sources.js";
import { PUBLIC_POLICY_LABELS } from "../../domain/public-knowledge-content.js";

const content = "P: Atende no sabado?\nR: Atendimento das9h as12h.", merchantId = "boundary-shop";
const source = { kind: "knowledge", merchantId, id: "faq-collection", sourceType: "faq", version: 123,
  active: true, chunks: [{ id: "public-faq", content }] } as const;
const candidate = { id: "legacy", merchantId, sourceType: "faq", sourceId: "faq-collection", content, similarity: 0.9 } as const;
const input = { merchantId, queryText: "Atende no sabado?", limit: 5 };

test("RAG02 canonical PostgreSQL fallback after graph admission provider or embedding failure", async () => {
  for (const reason of ["reader_not_readonly", "neo4j_unavailable", "embedding_unavailable", "timeout"]) {
    let reads = 0;
    const graph = new GraphKnowledgeReader({ enabledFor: () => true,
      searchKnowledge: async () => ({ status: "unavailable", reason }) } as any,
    { read: async () => source } as any);
    const query = new QueryKnowledgeUseCase({ isAvailable: () => true, generate: async () => [1] } as any,
      { similaritySearch: async (tenant, vector, limit) => { reads++;assert.equal(tenant, merchantId);
        assert.deepEqual(vector, [1]);assert.equal(limit, 5);return [candidate]; } } as any, undefined, graph);
    const result = await query.execute(input);
    assert.equal(reads, 1);assert.equal(result.chunks[0]?.content, content);assert.equal(result.chunks[0]?.id, "public-faq");
    assert.equal(result.chunks[0]?.merchantId, merchantId);
  }
});
test("legacy fallback excludes revoked changed foreign and private documentary candidates", async () => {
  for (const current of [null, { ...source, active: false }, { ...source, merchantId: "other" },
    { ...source, chunks: [{ id: "public-faq", content: "Horario alterado" }] }]) {
    let reads = 0;
    const graph = new GraphKnowledgeReader({ enabledFor: () => true,
      searchKnowledge: async () => ({ status: "unavailable", reason: "timeout" }) } as any,
    { read: async () => { reads++;return current; } } as any);
    const query = new QueryKnowledgeUseCase({ isAvailable: () => true, generate: async () => [1] } as any,
      { similaritySearch: async () => [candidate, { ...candidate, merchantId: "other" },
        { ...candidate, sourceType: "config", content: "private" }] } as any, undefined, graph);
    assert.deepEqual((await query.execute(input)).chunks, []);assert.equal(reads, 1);
  }
});
test("public policy fallback shares legacy content formatting and rehydrates current public IDs", async () => {
  const sources = new PublishedGraphKnowledgeSources({ publicSnapshot: async () => ({ merchantId, version: 123,
    policy: { returns: "Solicite a devolucao pelo atendimento." } }) }, { snapshot: async () => ({ merchantId, version: 123, items: [] }) });
  const graph = new GraphKnowledgeReader({ enabledFor: () => true } as any, sources);
  const chunks = await graph.revalidateLegacy(merchantId, [{ ...candidate, sourceType: "policy", sourceId: "returns",
    content: `${PUBLIC_POLICY_LABELS.returns}: Solicite a devolucao pelo atendimento.` }]);
  assert.equal(chunks.length, 1);assert.notEqual(chunks[0]?.id, "legacy");assert.equal(chunks[0]?.sourceType, "policy");
});
test("unavailable legacy embeddings perform no PostgreSQL search and create no synthetic vector", async () => {
  let reads = 0;
  for (const available of [false, true]) {
    const query = new QueryKnowledgeUseCase({ isAvailable: () => available, generate: async () => null } as any,
      { similaritySearch: async () => { reads++;throw Error(); } } as any, undefined,
      { enabledFor: () => true, search: async () => null, revalidateLegacy: async () => [] });
    assert.deepEqual((await query.execute(input)).chunks, []);
  }
  assert.equal(reads, 0);
});
