import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { RevalidatePublicSourceService } from "./revalidate-public-source.service.js";
import { projectPublicBusinessSource, type PublicBusinessSourceInput } from "../../../graph-rag/domain/public-business-source.js";
import { GRAPH_EMBEDDING_ID } from "../../../graph-rag/domain/graph-embedding-model.js";
import type { PublicEvidenceCandidate, PublicEvidenceSnapshot, PublicEvidenceSnapshotSet } from "../../domain/public-source-evidence.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function fixture(linked = true) {
  const merchantId = "own", version = "public-v1:00000000000000000001";
  const inputs: PublicBusinessSourceInput[] = [
    { merchantId, sourceType: "service", sourceId: "service", sourceVersion: "canonical-service:1", publicationState: "published",
      row: { name: "Public consultation", type: "service", isActive: true, professionals: linked
        ? [{ merchantId, professionalId: "professional", publicName: "Public professional", isActive: true, isPublished: true, linkIsActive: true }] : [] } },
    { merchantId, sourceType: "professional", sourceId: "professional", sourceVersion: "canonical-professional:1", publicationState: "published",
      row: { publicName: "Public professional", timeZone: "UTC", isActive: true, isPublished: true } },
  ];
  const candidates: PublicEvidenceCandidate[] = [];
  const sources: PublicEvidenceSnapshot[] = inputs.map(input => {
    const source = projectPublicBusinessSource(merchantId, input), chunkId = hash(JSON.stringify([input.sourceType, input.sourceId, 0]));
    const rowId = hash(JSON.stringify([merchantId, input.sourceType, input.sourceId, 1, chunkId]));
    const metadata = { publicSourceNamespace: "public-business-v1", schemaVersion: 1, sourceVersion: version, sourceHash: source.sourceHash,
      publicationState: "published", chunkId, contentHash: hash(source.text), embeddingModel: GRAPH_EMBEDDING_ID, embeddingDimensions: 384 };
    candidates.push({ origin: "public_graph", merchantId, sourceType: input.sourceType, sourceId: input.sourceId, ...metadata });
    return { sourceType: input.sourceType, sourceId: input.sourceId, source, hasPendingLegacy: false,
      latest: { sourceVersion: version, sourceHash: source.sourceHash, publicationState: "published", status: "completed",
        indexedAt: new Date(1), embeddingModel: GRAPH_EMBEDDING_ID, embeddingDimensions: 384 },
      chunks: [{ id: rowId, merchantId, sourceType: input.sourceType, sourceId: input.sourceId, content: source.text, metadata }] };
  });
  const snapshot: PublicEvidenceSnapshotSet = { sources, legacy: [] };
  const reader = new RevalidatePublicSourceService({ assertScope: scope => { if (scope !== merchantId) throw Error("scope"); },
    read: async () => structuredClone(snapshot) });
  const pair = { service: candidates[0]!, professional: candidates[1]! };
  return { merchantId, snapshot, pair, reader };
}

test("T70 canonical service-professional pairs", async t => {
  await t.test("current linked pair retains exact text and both independent provenance references", async () => {
    const f = fixture(), result = await f.reader.revalidatePairs({ merchantId: f.merchantId, pairs: [f.pair, f.pair] });
    assert.equal(result.status, "ready");assert.equal(result.pairs.length, 1);assert.equal(result.evidence.length, 2);
    assert.deepEqual(result.evidence.map(value => value.content), f.snapshot.sources.map(value => value.source!.text));
    assert.deepEqual(result.evidence.map(value => [value.provenance.sourceType, value.provenance.sourceId, value.provenance.sourceHash, value.provenance.publicWorkVersion]),
      f.snapshot.sources.map(value => [value.sourceType, value.sourceId, value.source!.sourceHash, value.latest!.sourceVersion]));
  });
  await t.test("two independently current published sources do not prove an unlinked pair", async () => {
    const f = fixture(false);
    assert.equal((await f.reader.revalidate({ merchantId: f.merchantId, candidates: [f.pair.service, f.pair.professional] })).evidence.length, 2);
    assert.deepEqual(await f.reader.revalidatePairs({ merchantId: f.merchantId, pairs: [f.pair] }), { status: "insufficient", pairs: [], evidence: [] });
  });
  await t.test("neither half-pair, retired source, changed version nor foreign tuple leaks context", async () => {
    for (const side of [0, 1]) {
      const f = fixture();f.snapshot.sources[side]!.latest!.status = "pending";
      assert.deepEqual(await f.reader.revalidatePairs({ merchantId: f.merchantId, pairs: [f.pair] }), { status: "insufficient", pairs: [], evidence: [] });
      const changed = fixture();changed.snapshot.sources[side]!.latest!.sourceVersion = "public-v1:00000000000000000002";
      assert.deepEqual(await changed.reader.revalidatePairs({ merchantId: changed.merchantId, pairs: [changed.pair] }), { status: "insufficient", pairs: [], evidence: [] });
    }
    for (const patch of [{ merchantId: "foreign" }, { sourceType: "service" }, { origin: "legacy_sql" as const }]) {
      const f = fixture();
      assert.deepEqual(await f.reader.revalidatePairs({ merchantId: f.merchantId, pairs: [{ ...f.pair, professional: { ...f.pair.professional, ...patch } }] }),
        { status: "insufficient", pairs: [], evidence: [] });
    }
    const f = fixture();f.snapshot.sources[0]!.source!.publicationState = "withdrawn";
    assert.deepEqual(await f.reader.revalidatePairs({ merchantId: f.merchantId, pairs: [f.pair] }), { status: "insufficient", pairs: [], evidence: [] });
    await assert.rejects(f.reader.revalidatePairs({ merchantId: "foreign", pairs: [f.pair] }), /scope/);
  });
  await t.test("oversized input is insufficient and canonical errors cannot return raw graph content", async () => {
    const f = fixture();
    assert.deepEqual(await f.reader.revalidatePairs({ merchantId: f.merchantId, pairs: Array(11).fill(f.pair) }), { status: "insufficient", pairs: [], evidence: [] });
    const unavailable = new RevalidatePublicSourceService({ assertScope: () => {}, read: async () => { throw Error("PRIVATE-DATABASE-CANARY"); } });
    assert.deepEqual(await unavailable.revalidatePairs({ merchantId: f.merchantId, pairs: [f.pair] }),
      { status: "unavailable", pairs: [], evidence: [], reason: "canonical_unavailable" });
  });
});
