import test from "node:test";
import assert from "node:assert/strict";
import { GraphProjectionService, catalogProjectionHash, documentProjectionHash, merchantGuideProjectionHash } from "./graph-projection.service.js";
import type { GraphProjectionTransactions } from "../domain/graph-rag.port.js";

const now = 1_790_000_000_000, embedding = [1, ...Array(383).fill(0)];
const source = { kind: "catalog" as const, merchantId: "a", id: "p", version: now - 1000, active: true,
  name: "Creme de hidratação", description: "Cuidado diário da pele", category: { id: "skin", name: "Pele" },
  variants: [{ id: "v", sku: "SKIN-1", active: true, attributes: { perfume: "não", material: "algodão" } }] };

function fixture() {
  const roots = new Map<string, { version: number; hash: string; active: boolean }>();
  const writes: Array<{ text: string; parameters: Record<string, unknown> }> = [];
  const transactions: GraphProjectionTransactions = { withProjection: async (_merchant, work) => work({ run: async (text, parameters = {}) => {
    writes.push({ text, parameters });
    if (text.includes(" AS admitted")) {
      const key = `${parameters.merchantId}:${parameters.sourceType ?? "product"}:${parameters.sourceId}`;
      const old = roots.get(key), version = Number(parameters.sourceVersion), hash = String(parameters.sourceHash);
      if (old && (old.version > version || old.version === version && old.hash !== hash)) return { records: [] };
      roots.set(key, { version, hash, active: parameters.active === true });
      return { records: [{ toObject: () => ({ admitted: true }) }] };
    }
    return { records: [] };
  } }) };
  return { roots, writes, projector: new GraphProjectionService(transactions, { modelId: "model-v1", dimensions: 384,
    generate: async () => [...embedding] }, () => now) };
}

const guide = { kind: "merchant_help", merchantId: "a", audience: "merchant", context: "cashback", sourceType: "merchant_guide",
  id: "cashback-use", version: now - 1000, active: true, chunks: [{ id: "cashback-use-main", content: "Uso depende das regras publicadas da loja." }] };
test("merchant guide projection carries tenant audience context version and hashes on dedicated entities", async () => {
  const f = fixture(); const result = await f.projector.projectMerchantGuide(guide);
  assert.deepEqual(result, { status: "applied", sourceHash: merchantGuideProjectionHash(guide) });
  assert.equal(f.writes.length, 3);
  for (const w of f.writes) {
    assert.equal(w.parameters.merchantId, "a"); assert.equal(w.parameters.audience, "merchant");
    assert.equal(w.parameters.context, "cashback"); assert.equal(w.parameters.sourceType, "merchant_guide");
    assert.ok(!w.text.includes(":ZyonGraphDocument")); assert.ok(!w.text.includes(":ZyonGraphChunk"));
    assert.match(w.text, /audience: \$audience, context: \$context/);
  }
  const chunks = f.writes[2]!.parameters.chunks as any[];
  assert.equal(chunks[0].id, "cashback-use-main"); assert.deepEqual(chunks[0].embedding, embedding);
  assert.match(chunks[0].contentHash, /^[a-f0-9]{64}$/);
  assert.match(f.writes[2]!.text, /c\.sourceHash = \$sourceHash/);
});
test("merchant guide projection rejects wrong audience context private fields and future versions", async () => {
  const f = fixture();
  for (const patch of [{ audience: "buyer" }, { context: "meta_ads" }, { sourceType: "faq" },
    { buyerEmail: "private@example.test" }, { version: now + 30001 }, { chunks: [] }])
    assert.deepEqual(await f.projector.projectMerchantGuide({ ...guide, ...patch }), { status: "unavailable", reason: "invalid_source" });
  assert.equal(f.writes.length, 0);
});
test("merchant guide tombstones remove embeddings and older versions cannot revive them", async () => {
  const f = fixture(); await f.projector.projectMerchantGuide(guide);
  assert.equal((await f.projector.projectMerchantGuide({ ...guide, active: false, version: now, chunks: [] })).status, "applied");
  assert.match(f.writes.at(-1)!.text, /REMOVE c\.embedding, c\.normalizedText/);
  assert.equal((await f.projector.projectMerchantGuide(guide)).status, "ignored");
});
test("merchant guide hash ignores ordering and version but changes with reviewed content", () => {
  const two = { ...guide, chunks: [...guide.chunks, { id: "second", content: "A carteira vale na mesma loja." }] };
  assert.equal(merchantGuideProjectionHash(two), merchantGuideProjectionHash({ ...two, version: now, chunks: [...two.chunks].reverse() }));
  assert.notEqual(merchantGuideProjectionHash(guide), merchantGuideProjectionHash({ ...guide, chunks: [{ ...guide.chunks[0], content: "Outra regra" }] }));
});
test("merchant guide embedding failure writes no partial reviewed source", async () => {
  let writes = 0;
  const projector = new GraphProjectionService({ withProjection: async () => { writes++; throw Error("no write"); } },
    { modelId: "model-v1", dimensions: 384, generate: async () => null }, () => now);
  assert.deepEqual(await projector.projectMerchantGuide(guide), { status: "unavailable", reason: "embedding_unavailable" });
  assert.equal(writes, 0);
});

test("RAG03 public provenance", async () => {
  const f = fixture();const result = await f.projector.projectCatalog(source);
  assert.equal(result.status, "applied");
  const first = f.writes[0]!.parameters;
  assert.equal(first.merchantId, "a");assert.equal(first.sourceId, "p");assert.equal(first.sourceVersion, source.version);
  assert.equal(first.modelId, "model-v1");assert.equal(first.sourceHash, catalogProjectionHash(source));
  const variant = f.writes.find(w => w.parameters.variants)?.parameters.variants as Array<Record<string, unknown>>;
  assert.equal(variant[0]!.id, "v");assert.deepEqual(variant[0]!.embedding, embedding);
  assert.match(String(variant[0]!.normalizedText), /hidratacao/);
  assert.match(f.writes[0]!.text, /_projectionLock/);
  assert.match(f.writes[0]!.text, /sourceVersion < \$sourceVersion/);
  assert.equal(catalogProjectionHash(source), catalogProjectionHash({ ...source, version: now,
    variants: [{ ...source.variants[0]!, attributes: { material: "algodão", perfume: "não" } }] }));
  assert.deepEqual(await f.projector.projectCatalog({ ...source, metadata: { buyerEmail: "private@example.test" } }),
    { status: "unavailable", reason: "invalid_source" });
});

test("RAG03 tombstone ordering", async () => {
  const f = fixture();await f.projector.projectCatalog(source);await f.projector.projectCatalog(source);
  const deleted = { kind: "catalog", merchantId: "a", id: "p", version: now, active: false };
  assert.equal((await f.projector.projectCatalog(deleted)).status, "applied");
  const writes = f.writes.length;
  assert.equal((await f.projector.projectCatalog(source)).status, "ignored");
  assert.equal(f.writes.length, writes + 1);
  assert.deepEqual(f.roots.get("a:product:p"), { version: now, hash: catalogProjectionHash(deleted), active: false });
  assert.equal((await f.projector.projectCatalog({ ...source, version: now })).status, "ignored");
  // This fake stores versions, but must also observe the actual persisted guard.
  assert.match(f.writes[0]!.text, /WITH p WHERE p\.sourceVersion < \$sourceVersion OR \(p\.sourceVersion = \$sourceVersion AND p\.sourceHash = \$sourceHash\)/);
  const document = { kind: "knowledge", merchantId: "a", id: "faq", sourceType: "faq", version: now - 1,
    active: true, chunks: [{ id: "q", content: "Conteudo publico" }] };
  await f.projector.projectDocument(document);
  await f.projector.projectDocument({ ...document, active: false, version: now, chunks: [] });
  assert.equal((await f.projector.projectDocument({ ...document, version: now })).status, "ignored");
  assert.match(f.writes.find(write => write.text.startsWith("MERGE (d:"))!.text,
    /WITH d WHERE d\.sourceVersion < \$sourceVersion OR \(d\.sourceVersion = \$sourceVersion AND d\.sourceHash = \$sourceHash\)/);
});

test("document projection admits public source types and content hashes only", async () => {
  const f = fixture();const document = { kind: "knowledge", merchantId: "a", id: "faq", sourceType: "faq", version: now,
    active: true, chunks: [{ id: "chunk-1", content: "Trocas podem ser solicitadas pelo atendimento." }] };
  assert.equal((await f.projector.projectDocument(document)).status, "applied");
  assert.equal(f.writes[0]!.parameters.sourceHash, documentProjectionHash(document));
  assert.equal(f.writes[0]!.parameters.sourceType, "faq");
  const chunks = f.writes.find(w => w.parameters.chunks)?.parameters.chunks as Array<Record<string, unknown>>;
  assert.match(String(chunks[0]!.contentHash), /^[a-f0-9]{64}$/);
  const count = f.writes.length;
  assert.deepEqual(await f.projector.projectDocument({ ...document, sourceType: "private_chat" }), { status: "unavailable", reason: "invalid_source" });
  assert.equal(f.writes.length, count);
});

test("an embedding failure cannot publish a partial source", async () => {
  let writes = 0;
  const projector = new GraphProjectionService({ withProjection: async () => { writes++;throw Error("must not write"); } },
    { modelId: "model-v1", dimensions: 384, generate: async () => null }, () => now);
  assert.deepEqual(await projector.projectCatalog(source), { status: "unavailable", reason: "embedding_unavailable" });
  assert.equal(writes, 0);
});
