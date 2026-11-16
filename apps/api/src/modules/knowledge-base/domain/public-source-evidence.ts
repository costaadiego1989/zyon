import type { PublicBusinessSourceProjection, PublicBusinessSourceType } from "../../graph-rag/domain/public-business-source.js";
import type { GraphPublicDocumentSource } from "../../graph-rag/domain/public-graph-sources.port.js";

export interface PublicEvidenceCandidate {
  origin: "public_graph" | "public_sql" | "legacy_graph" | "legacy_sql";
  merchantId: string;
  sourceType: string;
  sourceId: string;
  content?: string;
  rowId?: string;
  publicSourceNamespace?: string;
  schemaVersion?: number;
  sourceVersion?: string | number;
  sourceHash?: string;
  publicationState?: string;
  chunkId?: string;
  contentHash?: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
  normalizedText?: string;
  score?: number;
}
export interface PublicEvidenceWork {
  sourceVersion: string;
  sourceHash: string;
  publicationState: string;
  status: string;
  indexedAt: Date | null;
  embeddingModel: string | null;
  embeddingDimensions: number | null;
}
export interface PublicEvidenceStoredChunk {
  id: string;
  merchantId: string;
  sourceType: string;
  sourceId: string | null;
  content: string;
  metadata: unknown;
}
export interface PublicEvidenceSnapshot {
  sourceType: PublicBusinessSourceType;
  sourceId: string;
  source: PublicBusinessSourceProjection | null;
  latest: PublicEvidenceWork | null;
  hasPendingLegacy: boolean;
  chunks: PublicEvidenceStoredChunk[];
}
export interface LegacyEvidenceSnapshot {
  document: GraphPublicDocumentSource;
  references: Array<{ chunkId: string; source: PublicBusinessSourceProjection }>;
}
export interface PublicEvidenceSnapshotSet {
  sources: PublicEvidenceSnapshot[];
  legacy: LegacyEvidenceSnapshot[];
}
export interface PublicEvidenceCanonicalPort {
  assertScope(merchantId: string): void;
  read(merchantId: string, candidates: ReadonlyArray<Readonly<PublicEvidenceCandidate>>): Promise<PublicEvidenceSnapshotSet>;
}
/** Checked legacy graph document identity, separate from the current public
 * source revision and from a public-v1 indexing work revision. */
export interface LegacyKnowledgeRetrievalEvidence {
  readonly kind: "legacy-graph-retrieval";
  readonly merchantId: string;
  readonly sourceType: "faq" | "policy";
  readonly sourceId: string;
  readonly sourceVersion: number;
  readonly sourceHash: string;
  readonly embeddingModel: string;
  readonly embeddingDimensions: number;
  readonly chunkId: string;
  readonly contentHash: string;
  readonly projectedAt: number;
}
export interface ValidatedPublicEvidence {
  id: string;
  content: string;
  similarity?: number;
  retrieval?: Readonly<LegacyKnowledgeRetrievalEvidence>;
  provenance: {
    origin: PublicEvidenceCandidate["origin"];
    namespace: "public-business-v1" | "canonical-legacy";
    merchantId: string;
    sourceType: PublicBusinessSourceType;
    sourceId: string;
    sourceVersion: string;
    sourceHash: string;
    publicWorkVersion: string | null;
    publicationState: "published";
    embeddingModel: string | null;
    embeddingDimensions: number | null;
    chunkId: string;
    contentHash: string;
  };
}
export type PublicEvidenceResult =
  | { status: "ready"; evidence: ValidatedPublicEvidence[] }
  | { status: "insufficient" | "conflicting"; evidence: [] }
  | { status: "unavailable"; evidence: []; reason: "canonical_unavailable" };

export type KnowledgeResponseEvidence = Readonly<{
  status: PublicEvidenceResult["status"];
  evidence: ReadonlyArray<Readonly<ValidatedPublicEvidence>>;
}>;
