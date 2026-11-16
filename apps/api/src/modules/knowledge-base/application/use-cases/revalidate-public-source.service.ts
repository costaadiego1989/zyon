import { createHash } from "node:crypto";
import { GRAPH_EMBEDDING_ID } from "../../../graph-rag/domain/graph-embedding-model.js";
import { GRAPH_VECTOR_DIMENSIONS, normalizeGraphText } from "../../../graph-rag/domain/graph-query.js";
import { documentProjectionHash } from "../../../graph-rag/application/graph-projection.service.js";
import { publicBusinessTextChunks } from "../../../graph-rag/application/public-business-projection.service.js";
import { publicWorkSequence } from "../../../graph-rag/application/public-source-work-state.js";
import { PUBLIC_BUSINESS_SOURCE_NAMESPACE } from "../../domain/knowledge-chunk-namespace.js";
import type { KnowledgeChunk } from "../../domain/ports/knowledge-repository.port.js";
import type { PublicEvidenceCandidate, PublicEvidenceCanonicalPort, PublicEvidenceResult,
  PublicEvidenceSnapshot, LegacyEvidenceSnapshot, ValidatedPublicEvidence } from "../../domain/public-source-evidence.js";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const sourceTypes = ["company", "business_hours", "professional", "service", "faq", "policy"];
const origins = ["public_graph", "public_sql", "legacy_graph", "legacy_sql"];
const id = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim()) && value.length <= 191;
const empty = (): PublicEvidenceResult => ({ status: "insufficient", evidence: [] });

/** Admission happens after retrieval, independently of graph rollout. Only a
 * fresh canonical snapshot supplies answer text. The index is a candidate. */
export class RevalidatePublicSourceService {
  constructor(private readonly canonical: PublicEvidenceCanonicalPort) {}

  async revalidate(input: { merchantId: string; candidates: ReadonlyArray<PublicEvidenceCandidate> }): Promise<PublicEvidenceResult> {
    this.canonical.assertScope(input.merchantId);
    if (!Array.isArray(input.candidates) || input.candidates.length > 20) return empty();
    const candidates = input.candidates.filter(candidate => candidate && candidate.merchantId === input.merchantId
      && id(candidate.sourceId) && origins.includes(candidate.origin) && sourceTypes.includes(candidate.sourceType)
      && (candidate.origin.startsWith("public_") || ["faq", "policy"].includes(candidate.sourceType)
        && candidate.publicSourceNamespace !== PUBLIC_BUSINESS_SOURCE_NAMESPACE)).map(candidate => ({ ...candidate }));
    if (!candidates.length) return empty();
    try {
      const snapshot = await this.canonical.read(input.merchantId, candidates);
      const evidence: ValidatedPublicEvidence[] = [], seen = new Set<string>();
      for (const candidate of candidates) {
        const admitted = candidate.origin.startsWith("public_")
          ? this.publicEvidence(candidate, snapshot.sources.find(source => source.sourceType === candidate.sourceType && source.sourceId === candidate.sourceId))
          : this.legacyEvidence(candidate, snapshot.legacy.find(source => source.document.sourceType === candidate.sourceType && source.document.id === candidate.sourceId));
        for (const value of admitted) {
          const key = JSON.stringify([value.provenance.merchantId, value.provenance.sourceType, value.provenance.sourceId, value.provenance.chunkId]);
          if (!seen.has(key)) { seen.add(key);evidence.push(value); }
        }
      }
      return evidence.length ? { status: "ready", evidence: evidence.slice(0, 20) } : empty();
    } catch (error) {
      return error instanceof Error && error.message === "public_source_ambiguous"
        ? { status: "conflicting", evidence: [] }
        : { status: "unavailable", evidence: [], reason: "canonical_unavailable" };
    }
  }

  /** Existing selections have no public-v1/model proof. Match their exact text
   * against current public FAQ/policy and label only that canonical proof. */
  async revalidateLegacy(merchantId: string, chunks: KnowledgeChunk[], origin: "legacy_graph" | "legacy_sql" = "legacy_sql") {
    const result = await this.revalidate({ merchantId, candidates: chunks.slice(0, 20).map(chunk => ({ origin: "legacy_sql" as const,
      merchantId: chunk.merchantId, sourceType: chunk.sourceType, sourceId: chunk.sourceId ?? "", content: chunk.content,
      publicSourceNamespace: typeof chunk.metadata?.publicSourceNamespace === "string" ? chunk.metadata.publicSourceNamespace : undefined,
      score: chunk.similarity })) });
    if (result.status === "ready" && origin === "legacy_graph")
      for (const item of result.evidence) item.provenance.origin = origin;
    return result;
  }

  private publicEvidence(candidate: PublicEvidenceCandidate, snapshot?: PublicEvidenceSnapshot): ValidatedPublicEvidence[] {
    const source = snapshot?.source, work = snapshot?.latest;
    if (!snapshot || !source || !work || snapshot.hasPendingLegacy || work.status !== "completed" || !work.indexedAt
      || source.merchantId !== candidate.merchantId || source.sourceType !== candidate.sourceType || source.sourceId !== candidate.sourceId
      || source.publicationState !== "published" || !source.text.trim() || work.publicationState !== "published" || work.sourceHash !== source.sourceHash
      || work.embeddingModel !== GRAPH_EMBEDDING_ID || work.embeddingDimensions !== GRAPH_VECTOR_DIMENSIONS) return [];
    const expected = { publicSourceNamespace: PUBLIC_BUSINESS_SOURCE_NAMESPACE, schemaVersion: 1, sourceVersion: work.sourceVersion,
      sourceHash: source.sourceHash, publicationState: "published", embeddingModel: GRAPH_EMBEDDING_ID, embeddingDimensions: GRAPH_VECTOR_DIMENSIONS };
    if (Object.entries(expected).some(([key, value]) => candidate[key as keyof PublicEvidenceCandidate] !== value)) return [];
    let revision: number;
    try { revision = publicWorkSequence(work.sourceVersion); } catch { return []; }
    const texts = publicBusinessTextChunks(source.text);
    const index = texts.findIndex((_text, offset) => hash(JSON.stringify([source.sourceType, source.sourceId, offset])) === candidate.chunkId);
    if (index < 0) return [];
    const content = texts[index]!, contentHash = hash(content), chunkId = candidate.chunkId!;
    const rowId = hash(JSON.stringify([candidate.merchantId, candidate.sourceType, candidate.sourceId, revision, chunkId]));
    if (candidate.contentHash !== contentHash || candidate.origin === "public_sql" && (candidate.rowId !== rowId || candidate.content !== content)
      || candidate.normalizedText !== undefined && candidate.normalizedText !== normalizeGraphText(content)) return [];
    const row = snapshot.chunks.find(chunk => chunk.id === rowId && chunk.merchantId === candidate.merchantId
      && chunk.sourceType === candidate.sourceType && chunk.sourceId === candidate.sourceId && chunk.content === content);
    if (!row || !row.metadata || typeof row.metadata !== "object" || Array.isArray(row.metadata)) return [];
    const metadata = row.metadata as Record<string, unknown>;
    if (Object.entries({ ...expected, chunkId, contentHash }).some(([key, value]) => metadata[key] !== value)) return [];
    return [{ id: rowId, content, ...(Number.isFinite(candidate.score) ? { similarity: candidate.score } : {}), provenance: {
      origin: candidate.origin, namespace: "public-business-v1", merchantId: source.merchantId, sourceType: source.sourceType, sourceId: source.sourceId,
      sourceVersion: source.sourceVersion, sourceHash: source.sourceHash, publicWorkVersion: work.sourceVersion, publicationState: "published",
      embeddingModel: GRAPH_EMBEDDING_ID, embeddingDimensions: GRAPH_VECTOR_DIMENSIONS, chunkId, contentHash } }];
  }

  private legacyEvidence(candidate: PublicEvidenceCandidate, snapshot?: LegacyEvidenceSnapshot): ValidatedPublicEvidence[] {
    const document = snapshot?.document;
    if (!snapshot || !document || !document.active || document.merchantId !== candidate.merchantId || document.sourceType !== candidate.sourceType
      || document.id !== candidate.sourceId) return [];
    const chunks = document.chunks ?? [];
    let matching = chunks.filter(chunk => chunk.content === candidate.content);
    if (candidate.origin === "legacy_graph") {
      if (candidate.sourceVersion !== document.version || candidate.sourceHash !== documentProjectionHash(document)
        || candidate.embeddingModel !== GRAPH_EMBEDDING_ID || candidate.embeddingDimensions !== GRAPH_VECTOR_DIMENSIONS) return [];
      matching = chunks.filter(chunk => chunk.id === candidate.chunkId && hash(chunk.content) === candidate.contentHash);
    } else if (!matching.length && candidate.sourceType === "policy" && chunks.map(chunk => chunk.content).join("") === candidate.content)
      matching = chunks;
    const evidence: ValidatedPublicEvidence[] = [];
    for (const chunk of matching) {
      const references = snapshot.references.filter(reference => reference.chunkId === chunk.id);
      // Different current FAQ identities may intentionally publish identical
      // text. Preserve their separate provenance; duplicate IDs are rejected
      // while loading the canonical snapshot, before deduplicating its text.
      for (const { source } of references) {
        if (source.merchantId !== candidate.merchantId || source.sourceType !== candidate.sourceType
          || source.publicationState !== "published" || !source.text.trim()
          || source.sourceType === "policy" && source.sourceId !== candidate.sourceId) continue;
        const parts: string[] = [];
        for (let start = 0; start < source.text.length; start += 7500) parts.push(source.text.slice(start, start + 7500));
        if (!parts.includes(chunk.content)) continue;
        evidence.push({ id: chunk.id, content: chunk.content, ...(Number.isFinite(candidate.score) ? { similarity: candidate.score } : {}), provenance: {
          origin: candidate.origin, namespace: "canonical-legacy", merchantId: source.merchantId, sourceType: source.sourceType, sourceId: source.sourceId,
          sourceVersion: source.sourceVersion, sourceHash: source.sourceHash, publicWorkVersion: null, publicationState: "published",
          embeddingModel: candidate.origin === "legacy_graph" ? candidate.embeddingModel! : null,
          embeddingDimensions: candidate.origin === "legacy_graph" ? candidate.embeddingDimensions! : null, chunkId: chunk.id, contentHash: hash(chunk.content) } });
      }
    }
    return evidence;
  }
}
