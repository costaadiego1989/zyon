export const KNOWLEDGE_REPOSITORY = Symbol("KNOWLEDGE_REPOSITORY");

export interface KnowledgeChunk {
  id: string;
  merchantId: string;
  sourceType: "product" | "policy" | "faq" | "config";
  sourceId?: string;
  content: string;
  metadata?: Record<string, unknown>;
  similarity?: number;
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

  countBySource(merchantId: string): Promise<Record<string, number>>;

  similaritySearch(
    merchantId: string,
    queryEmbedding: number[],
    limit?: number,
    threshold?: number
  ): Promise<KnowledgeChunk[]>;
}
