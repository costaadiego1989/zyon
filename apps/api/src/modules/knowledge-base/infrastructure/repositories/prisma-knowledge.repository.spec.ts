import assert from "node:assert/strict";
import test from "node:test";
import { PrismaKnowledgeRepository } from "./prisma-knowledge.repository.js";

const row = (id: string, extra = {}) => ({ id, merchant_id: "merchant-a", source_type: "faq", source_id: "faq", content: "Retirada no balcão cadastrado.", metadata: {}, embedding: "[1,0]", ...extra });

for (const primary of [[], [row("irrelevant-vector", { similarity: 0.1 })]]) {
  test("RAG retrieves matching JSON embeddings when pgvector succeeds but has no relevant matching-model rows", async () => {
    let fallbackReads = 0;
    const repo = new PrismaKnowledgeRepository({
      $queryRawUnsafe: async (_sql: string, _vector: string, merchantId: string) => { assert.equal(merchantId, "merchant-a"); return primary; },
      $queryRaw: async (_strings: unknown, merchantId: string) => { fallbackReads++; assert.equal(merchantId, "merchant-a"); return [row("matching"), row("unrelated", { embedding: "[0,1]" }), row("wrong-model", { embedding: "[1,0,0]" }), row("other-tenant", { merchant_id: "merchant-b" })]; },
    } as any);
    const results = await repo.similaritySearch("merchant-a", [1, 0], 5, 0.65);
    assert.equal(fallbackReads, 1);
    assert.deepEqual(results.map(result => result.id), ["matching"]);
    assert.equal(results[0].content, "Retirada no balcão cadastrado.");
  });
}

test("vector retrieval respects similarity threshold and tenant ownership without a second read when relevant", async () => {
  const repo = new PrismaKnowledgeRepository({
    $queryRawUnsafe: async () => [row("matching", { similarity: 0.9 }), row("irrelevant", { similarity: 0.1 }), row("other-tenant", { merchant_id: "merchant-b", similarity: 1 })],
    $queryRaw: async () => assert.fail("valid primary retrieval needs no fallback scan"),
  } as any);
  assert.deepEqual((await repo.similaritySearch("merchant-a", [1, 0], 5, 0.65)).map(result => result.id), ["matching"]);
});
