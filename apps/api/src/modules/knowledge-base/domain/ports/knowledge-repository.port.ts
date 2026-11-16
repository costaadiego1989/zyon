import type { PublicBusinessSourceType } from "../../../graph-rag/domain/public-business-source.js";
import type { LegacyKnowledgeRetrievalEvidence, ValidatedPublicEvidence } from "../public-source-evidence.js";

export const KNOWLEDGE_REPOSITORY = Symbol("KNOWLEDGE_REPOSITORY");

export interface KnowledgeChunk {
  id: string;
  merchantId: string;
  sourceType: PublicBusinessSourceType | "product" | "config";
  sourceId?: string;
  content: string;
  metadata?: Record<string, unknown>;
  similarity?: number;
  /** Canonically admitted references, never raw storage metadata. */
  provenance?: ReadonlyArray<Readonly<ValidatedPublicEvidence["provenance"]>>;
  retrieval?: ReadonlyArray<Readonly<LegacyKnowledgeRetrievalEvidence>>;
}

export interface KnowledgeRepositoryPort {
  upsertChunks(
    merchantId: string,
    sourceType: string,
    sourceId: string,
    chunks: {
      content: string;
      embedding: number[];
      metadata?: Record<string, unknown>;
    }[]
  ): Promise<void>;

  deleteBySource(merchantId: string, sourceType: string, sourceId: string): Promise<void>;

  /** Fetch chunks for one (sourceType, sourceId) — used to merge partial config updates. */
  findBySource(merchantId: string, sourceType: string, sourceId: string): Promise<KnowledgeChunk[]>;

  countBySource(merchantId: string): Promise<Record<string, number>>;

  similaritySearch(
    merchantId: string,
    queryEmbedding: number[],
    limit?: number,
    threshold?: number
  ): Promise<KnowledgeChunk[]>;
}
