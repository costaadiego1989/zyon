import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { QueryKnowledgeUseCase } from "./query-knowledge.use-case.js";
import { projectPublicBusinessSource } from "../../../graph-rag/domain/public-business-source.js";
import { publicBusinessTextChunks } from "../../../graph-rag/application/public-business-projection.service.js";
import { GRAPH_EMBEDDING_ID } from "../../../graph-rag/domain/graph-embedding-model.js";
import { normalizeGraphText } from "../../../graph-rag/domain/graph-query.js";
import { documentProjectionHash } from "../../../graph-rag/application/graph-projection.service.js";
import { RevalidatePublicSourceService } from "./revalidate-public-source.service.js";
import type { PublicEvidenceCanonicalPort, PublicEvidenceSnapshotSet, PublicEvidenceCandidate } from "../../domain/public-source-evidence.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function fixture() {
  const merchantId = "tenant-a", sourceId = merchantId, sourceType = "company" as const;
  const source = projectPublicBusinessSource(merchantId, { merchantId, sourceId, sourceType, sourceVersion: "canonical:1", publicationState: "published",
    row: { name: "Public company", businessMode: "services", storeSettings: { company: { description: "Current public description" } } } });
  const version = "public-v1:" + "1".padStart(20, "0"), content = publicBusinessTextChunks(source.text)[0]!;
  const chunkId = hash(JSON.stringify([sourceType, sourceId, 0])), id = hash(JSON.stringify([merchantId, sourceType, sourceId, 1, chunkId]));
  const metadata = { publicSourceNamespace: "public-business-v1", schemaVersion: 1, sourceVersion: version,
    sourceHash: source.sourceHash, publicationState: "published", chunkId, contentHash: hash(content), embeddingModel: GRAPH_EMBEDDING_ID, embeddingDimensions: 384 };
  const row = { id, merchantId, sourceType, sourceId, content, metadata };
  const candidate: PublicEvidenceCandidate = { origin: "public_sql", merchantId, sourceType, sourceId, rowId: id, content, ...metadata };
  const snapshot: PublicEvidenceSnapshotSet = { sources: [{ sourceType, sourceId, source,
    latest: { sourceVersion: version, sourceHash: source.sourceHash, publicationState: "published", status: "completed", indexedAt: new Date(),
      embeddingModel: GRAPH_EMBEDDING_ID, embeddingDimensions: 384 }, hasPendingLegacy: false, chunks: [row] }], legacy: [] };
  let reads = 0;
  const port: PublicEvidenceCanonicalPort = { assertScope: id => { if (id !== merchantId) throw Error("public_evidence_scope_mismatch"); },
    read: async () => { reads++;return structuredClone(snapshot); } };
  return { merchantId, source, candidate, snapshot, port, reader: new RevalidatePublicSourceService(port), reads: () => reads };
}

test("T68", async t => {
  await t.test("disabled graph cannot bypass canonical admission of stale legacy SQL text", async () => {
    const candidate = { id: "old", merchantId: "tenant-a", sourceType: "faq", sourceId: "faq-collection", content: "STALE-PRIVATE-LEGACY-CONTENT" };
    const Query = QueryKnowledgeUseCase as any;
    const query = new Query({ isAvailable: () => true, generate: async () => [1] },
      { similaritySearch: async () => [candidate] }, undefined,
      { enabledFor: () => false }, { revalidateLegacy: async () => ({ status: "insufficient", evidence: [] }) });
    const result = await query.execute({ merchantId: "tenant-a", queryText: "Public question" });
    assert.deepEqual(result.chunks, []);
    assert.equal(result.status, "insufficient");
    assert.equal(JSON.stringify(result).includes(candidate.content), false);
  });

  await t.test("current public SQL and graph hints rehydrate exact canonical text and provenance", async () => {
    const f = fixture();
    for (const candidate of [f.candidate, { ...f.candidate, origin: "public_graph" as const, content: undefined, rowId: undefined,
      normalizedText: normalizeGraphText(f.source.text) }]) {
      const result = await f.reader.revalidate({ merchantId: f.merchantId, candidates: [candidate] });
      assert.equal(result.status, "ready");assert.equal(result.evidence.length, 1);
      assert.equal(result.evidence[0]!.content, f.source.text);
      assert.deepEqual(result.evidence[0]!.provenance, { origin: candidate.origin, namespace: "public-business-v1", merchantId: f.merchantId,
        sourceType: "company", sourceId: f.merchantId, sourceVersion: f.source.sourceVersion, sourceHash: f.source.sourceHash,
        publicWorkVersion: f.candidate.sourceVersion, publicationState: "published", embeddingModel: GRAPH_EMBEDDING_ID, embeddingDimensions: 384,
        chunkId: f.candidate.chunkId, contentHash: hash(f.source.text) });
    }
  });

  await t.test("foreign malformed and oversized candidate sets cannot authorize a canonical lookup", async () => {
    const f = fixture();
    for (const candidates of [[{ ...f.candidate, merchantId: "foreign" }], [{ ...f.candidate, sourceType: "private_note" }],
      [{ ...f.candidate, sourceId: "" }], Array.from({ length: 21 }, () => f.candidate)]) {
      assert.deepEqual(await f.reader.revalidate({ merchantId: f.merchantId, candidates }), { status: "insufficient", evidence: [] });
    }
    assert.equal(f.reads(), 0);
    await assert.rejects(f.reader.revalidate({ merchantId: "foreign", candidates: [f.candidate] }), /scope/);
    assert.equal(f.reads(), 0);
  });

  await t.test("public namespace revision hash schema model dimensions chunk and row identity are all binding", async () => {
    const f = fixture();
    for (const patch of [{ publicSourceNamespace: undefined }, { schemaVersion: 2 }, { sourceVersion: "public-v1:old" },
      { sourceHash: "f".repeat(64) }, { embeddingModel: "different-model-also-384" }, { embeddingDimensions: 128 },
      { chunkId: "0".repeat(64) }, { contentHash: "0".repeat(64) }, { rowId: "another-row" }, { content: "PRIVATE-CANARY" }, { normalizedText: "wrong graph normalization" }]) {
      const result = await f.reader.revalidate({ merchantId: f.merchantId, candidates: [{ ...f.candidate, ...patch }] });
      assert.deepEqual(result, { status: "insufficient", evidence: [] });assert.equal(JSON.stringify(result).includes("PRIVATE-CANARY"), false);
    }
  });

  await t.test("latest pending processing failed wrong ABI or unresolved ABA work refuses old completed evidence", async () => {
    for (const status of ["pending", "processing", "failed"]) {
      const f = fixture();f.snapshot.sources[0]!.latest!.status = status;
      assert.deepEqual(await f.reader.revalidate({ merchantId: f.merchantId, candidates: [f.candidate] }), { status: "insufficient", evidence: [] });
    }
    for (const mutate of [(f: ReturnType<typeof fixture>) => { f.snapshot.sources[0]!.hasPendingLegacy = true; },
      (f: ReturnType<typeof fixture>) => { f.snapshot.sources[0]!.latest!.embeddingModel = "old-384-model"; },
      (f: ReturnType<typeof fixture>) => { f.snapshot.sources[0]!.latest!.indexedAt = null; },
      (f: ReturnType<typeof fixture>) => { f.snapshot.sources[0]!.latest!.sourceVersion = "public-v1:" + "2".padStart(20, "0"); }]) {
      const f = fixture();mutate(f);
      assert.deepEqual(await f.reader.revalidate({ merchantId: f.merchantId, candidates: [f.candidate] }), { status: "insufficient", evidence: [] });
    }
  });

  await t.test("canonical withdrawal hash change or absent SQL publication defeats even a correct graph hint", async () => {
    for (const mutate of [(f: ReturnType<typeof fixture>) => { f.snapshot.sources[0]!.source = null; },
      (f: ReturnType<typeof fixture>) => { f.snapshot.sources[0]!.source!.publicationState = "withdrawn"; },
      (f: ReturnType<typeof fixture>) => { f.snapshot.sources[0]!.source!.sourceHash = "f".repeat(64); },
      (f: ReturnType<typeof fixture>) => { f.snapshot.sources[0]!.chunks = []; },
      (f: ReturnType<typeof fixture>) => { f.snapshot.sources[0]!.chunks[0]!.metadata = {}; }]) {
      const f = fixture();mutate(f);
      assert.deepEqual(await f.reader.revalidate({ merchantId: f.merchantId, candidates: [{ ...f.candidate, origin: "public_graph" }] }),
        { status: "insufficient", evidence: [] });
    }
  });

  await t.test("static projection age and a private-only version edit do not expire unchanged public content", async () => {
    const f = fixture();f.snapshot.sources[0]!.source!.sourceVersion = "canonical:private-only-newer";
    const result = await f.reader.revalidate({ merchantId: f.merchantId, candidates: [{ ...f.candidate, projectedAt: 0 } as any] });
    assert.equal(result.status, "ready");assert.equal(result.evidence[0]!.content, f.source.text);
    assert.equal(result.evidence[0]!.provenance.publicWorkVersion, f.candidate.sourceVersion);
  });

  await t.test("canonical outage ambiguity and absence have distinct safe results with no raw error details", async () => {
    const f = fixture();
    for (const [message, status] of [["SQL PRIVATE-CONNECTION-DETAIL", "unavailable"], ["public_source_ambiguous", "conflicting"]]) {
      const reader = new RevalidatePublicSourceService({ ...f.port, read: async () => { throw Error(message); } });
      const result = await reader.revalidate({ merchantId: f.merchantId, candidates: [f.candidate] });
      assert.equal(result.status, status);assert.deepEqual(result.evidence, []);
      if (result.status === "unavailable") assert.equal(result.reason, "canonical_unavailable");
      assert.equal(JSON.stringify(result).includes("PRIVATE-CONNECTION"), false);
    }
  });

  await t.test("legacy current text gets canonical-only provenance and late or explicit-empty content is refused", async () => {
    const f = fixture(), content = "P: Public question?\nR: Current answer.", chunkId = hash("faq-collection\0" + content);
    const source = projectPublicBusinessSource(f.merchantId, { merchantId: f.merchantId, sourceId: "faq-one", sourceType: "faq", sourceVersion: "faq:2",
      publicationState: "published", row: { question: "Public question?", answer: "Current answer." } });
    const document = { kind: "knowledge" as const, merchantId: f.merchantId, id: "faq-collection", sourceType: "faq" as const,
      version: 2, active: true, chunks: [{ id: chunkId, content }] };
    f.snapshot.legacy = [{ document, references: [{ chunkId, source }] }];
    const candidate: PublicEvidenceCandidate = { origin: "legacy_sql", merchantId: f.merchantId, sourceType: "faq", sourceId: "faq-collection", content };
    const result = await f.reader.revalidate({ merchantId: f.merchantId, candidates: [candidate] });
    assert.equal(result.status, "ready");assert.equal(result.evidence[0]!.content, content);
    assert.equal(result.evidence[0]!.provenance.sourceId, "faq-one");assert.equal(result.evidence[0]!.provenance.namespace, "canonical-legacy");
    assert.equal(result.evidence[0]!.provenance.publicWorkVersion, null);assert.equal(result.evidence[0]!.provenance.embeddingModel, null);
    assert.deepEqual(await f.reader.revalidate({ merchantId: f.merchantId, candidates: [{ ...candidate, content: "P: Old?\nR: Private stale answer." }] }),
      { status: "insufficient", evidence: [] });
    document.active = false;
    assert.deepEqual(await f.reader.revalidate({ merchantId: f.merchantId, candidates: [candidate] }), { status: "insufficient", evidence: [] });
  });

  await t.test("legacy graph version source and content hashes cannot impersonate a current individual FAQ", async () => {
    const f = fixture(), content = "P: Current?\nR: Yes.", chunkId = hash("faq-collection\0" + content);
    const source = projectPublicBusinessSource(f.merchantId, { merchantId: f.merchantId, sourceId: "real-faq", sourceType: "faq", sourceVersion: "faq:1",
      publicationState: "published", row: { question: "Current?", answer: "Yes." } });
    const document = { kind: "knowledge" as const, merchantId: f.merchantId, id: "faq-collection", sourceType: "faq" as const, version: 1, active: true, chunks: [{ id: chunkId, content }] };
    f.snapshot.legacy = [{ document, references: [{ chunkId, source }] }];
    const candidate: PublicEvidenceCandidate = { origin: "legacy_graph", merchantId: f.merchantId, sourceType: "faq", sourceId: "faq-collection",
      sourceVersion: 1, sourceHash: documentProjectionHash(document), chunkId, contentHash: hash(content), embeddingModel: GRAPH_EMBEDDING_ID, embeddingDimensions: 384 };
    assert.equal((await f.reader.revalidate({ merchantId: f.merchantId, candidates: [candidate] })).status, "ready");
    for (const patch of [{ sourceVersion: 2 }, { sourceHash: "0".repeat(64) }, { contentHash: "0".repeat(64) }, { chunkId: "not-current" }])
      assert.deepEqual(await f.reader.revalidate({ merchantId: f.merchantId, candidates: [{ ...candidate, ...patch }] }), { status: "insufficient", evidence: [] });
  });

  await t.test("distinct FAQ identities agreeing on exact public text retain both references without a false conflict", async () => {
    const f = fixture(), content = "P: Hours?\nR: 9-12.", chunkId = hash("faq-collection\0" + content);
    const references = ["faq-a", "faq-b"].map(sourceId => ({ chunkId, source: projectPublicBusinessSource(f.merchantId, {
      merchantId: f.merchantId, sourceId, sourceType: "faq", sourceVersion: "faq:current", publicationState: "published",
      row: { question: "Hours?", answer: "9-12." } }) }));
    f.snapshot.legacy = [{ document: { kind: "knowledge", merchantId: f.merchantId, id: "faq-collection", sourceType: "faq", version: 1,
      active: true, chunks: [{ id: chunkId, content }] }, references }];
    const candidate: PublicEvidenceCandidate = { origin: "legacy_sql", merchantId: f.merchantId, sourceType: "faq", sourceId: "faq-collection", content };
    const result = await f.reader.revalidate({ merchantId: f.merchantId, candidates: [candidate] });
    assert.equal(result.status, "ready");assert.deepEqual(result.evidence.map(item => item.provenance.sourceId), ["faq-a", "faq-b"]);
    assert.ok(result.evidence.every(item => item.content === content && item.provenance.namespace === "canonical-legacy"));
    const query = new QueryKnowledgeUseCase({ isAvailable: () => true, generate: async () => [1] } as any,
      { similaritySearch: async () => [{ id: "stored", merchantId: f.merchantId, sourceType: "faq", sourceId: "faq-collection", content }] } as any,
      undefined, { enabledFor: () => false } as any, f.reader);
    const output = await query.execute({ merchantId: f.merchantId, queryText: "Hours?" });
    assert.equal(output.status, "ready");assert.equal(output.chunks.length, 1);assert.equal(output.chunks[0]!.content, content);
    assert.deepEqual(output.evidence!.map(item => item.provenance.sourceId), ["faq-a", "faq-b"]);
  });
});
