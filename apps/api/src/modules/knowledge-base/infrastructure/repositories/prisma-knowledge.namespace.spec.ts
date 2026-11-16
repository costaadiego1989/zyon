import assert from "node:assert/strict";
import test from "node:test";
import { PrismaKnowledgeRepository } from "./prisma-knowledge.repository.js";
import { PUBLIC_BUSINESS_SOURCE_NAMESPACE } from "../../domain/knowledge-chunk-namespace.js";

// SQL-composition units only. These doubles do not execute PostgreSQL/pgvector.
const row = { id: "legacy-faq", merchant_id: "merchant-a", source_type: "faq", source_id: "faq-collection",
  content: "Current public FAQ", metadata: null, embedding: "[1,0]", similarity: 0.9 };
const taggedText = (strings: TemplateStringsArray) => strings.join("?");
const assertProductGuard = (sql: string) => {
  assert.match(sql, /k\.source_type <> 'product' OR EXISTS/);
  assert.match(sql, /p\.id = k\.source_id/);
  assert.match(sql, /p\.merchant_id = k\.merchant_id AND p\.is_active AND p\.deleted_at IS NULL/);
};

test("T66 legacy pgvector SQL binds the public namespace exclusion before ranking and limit", async () => {
  const repo = new PrismaKnowledgeRepository({
    $queryRawUnsafe: async (sql: string, vector: string, merchantId: string, limit: number, namespace: string) => {
      assert.equal(vector, "[1,0]"); assert.equal(merchantId, "merchant-a"); assert.equal(limit, 1);
      assert.equal(namespace, PUBLIC_BUSINESS_SOURCE_NAMESPACE);
      const guard = sql.indexOf("(k.metadata->>'publicSourceNamespace') IS DISTINCT FROM $4");
      assert.ok(guard > sql.indexOf("WHERE k.merchant_id = $2"));
      assert.ok(guard < sql.indexOf("ORDER BY")); assert.ok(guard < sql.indexOf("LIMIT $3"));
      assertProductGuard(sql); return [row];
    },
    $queryRaw: async () => assert.fail("relevant primary rows must not require a fallback scan"),
  } as any);
  assert.deepEqual((await repo.similaritySearch("merchant-a", [1, 0], 1)).map(chunk => chunk.id), [row.id]);
});

for (const primary of ["unavailable", "empty", "irrelevant"] as const) {
  test(`T66 legacy JSON SQL excludes the public namespace after ${primary} primary retrieval`, async () => {
    let reads = 0;
    const repo = new PrismaKnowledgeRepository({
      $queryRawUnsafe: async () => {
        if (primary === "unavailable") throw new Error("synthetic_pgvector_unavailable");
        return primary === "empty" ? [] : [{ ...row, similarity: 0.1 }];
      },
      $queryRaw: async (strings: TemplateStringsArray, merchantId: string, namespace: string) => {
        reads++; assert.equal(merchantId, "merchant-a"); assert.equal(namespace, PUBLIC_BUSINESS_SOURCE_NAMESPACE);
        const sql = taggedText(strings);
        assert.match(sql, /\(k\.metadata->>'publicSourceNamespace'\) IS DISTINCT FROM \?/);
        assertProductGuard(sql); assert.doesNotMatch(sql, /ORDER BY|LIMIT/);
        return [row];
      },
    } as any);
    assert.deepEqual((await repo.similaritySearch("merchant-a", [1, 0], 1)).map(chunk => chunk.id), [row.id]);
    assert.equal(reads, 1);
  });
}

test("T66 legacy replacement scopes its deletion away from the worker namespace", async () => {
  let deletion = 0, insertion = 0;
  const repo = new PrismaKnowledgeRepository({
    $executeRaw: async (strings: TemplateStringsArray, merchantId: string, type: string, sourceId: string, namespace: string) => {
      deletion++; const sql = taggedText(strings);
      assert.match(sql, /DELETE FROM knowledge_chunks/);
      assert.match(sql, /\(metadata->>'publicSourceNamespace'\) IS DISTINCT FROM \?/);
      assert.deepEqual([merchantId, type, sourceId, namespace], ["merchant-a", "faq", "faq-collection", PUBLIC_BUSINESS_SOURCE_NAMESPACE]);
      return 1;
    },
    $executeRawUnsafe: async (sql: string, ...values: unknown[]) => {
      insertion++; assert.match(sql, /INSERT INTO knowledge_chunks/);
      assert.deepEqual(values.slice(1, 4), ["merchant-a", "faq", "faq-collection"]);
      return 1;
    },
  } as any);
  await repo.upsertChunks("merchant-a", "faq", "faq-collection", [{ content: row.content, embedding: [1, 0] }]);
  assert.equal(deletion, 1); assert.equal(insertion, 1);
});

test("T66 legacy explicit deletion preserves the worker namespace for the same identity", async () => {
  let writes = 0;
  const repo = new PrismaKnowledgeRepository({
    $executeRaw: async (strings: TemplateStringsArray, merchantId: string, type: string, sourceId: string, namespace: string) => {
      writes++; const sql = taggedText(strings);
      assert.match(sql, /DELETE FROM knowledge_chunks/);
      assert.match(sql, /\(metadata->>'publicSourceNamespace'\) IS DISTINCT FROM \?/);
      assert.deepEqual([merchantId, type, sourceId, namespace], ["merchant-a", "policy", "returns", PUBLIC_BUSINESS_SOURCE_NAMESPACE]);
      return 1;
    },
  } as any);
  await repo.deleteBySource("merchant-a", "policy", "returns"); assert.equal(writes, 1);
});

test("T66 a legacy upsert cannot manufacture the reserved worker namespace or delete first", async () => {
  const repo = new PrismaKnowledgeRepository({
    $executeRaw: async () => assert.fail("reserved namespace must be refused before deletion"),
    $executeRawUnsafe: async () => assert.fail("reserved namespace must not be inserted through the legacy writer"),
  } as any);
  await assert.rejects(repo.upsertChunks("merchant-a", "faq", "faq-collection", [{ content: row.content, embedding: [1, 0],
    metadata: { publicSourceNamespace: PUBLIC_BUSINESS_SOURCE_NAMESPACE } }]), /public_business_namespace_owned_by_index_worker/);
});
