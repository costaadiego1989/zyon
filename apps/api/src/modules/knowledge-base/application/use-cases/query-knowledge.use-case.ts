import { Injectable, Inject, Logger } from "@nestjs/common";
import { EMBEDDING_PORT, type EmbeddingPort } from "../../domain/ports/embedding.port.js";
import {
  KNOWLEDGE_REPOSITORY,
  type KnowledgeRepositoryPort,
  type KnowledgeChunk,
} from "../../domain/ports/knowledge-repository.port.js";

export interface QueryKnowledgeInput {
  merchantId: string;
  queryText: string;
  limit?: number;
  threshold?: number;
}

export interface QueryKnowledgeOutput {
  chunks: KnowledgeChunk[];
}

@Injectable()
export class QueryKnowledgeUseCase {
  private readonly logger = new Logger(QueryKnowledgeUseCase.name);

  constructor(
    @Inject(EMBEDDING_PORT) private readonly embeddingService: EmbeddingPort,
    @Inject(KNOWLEDGE_REPOSITORY) private readonly knowledgeRepo: KnowledgeRepositoryPort,
  ) {}

  async execute(input: QueryKnowledgeInput): Promise<QueryKnowledgeOutput> {
    // Default: return empty if embedding unavailable
    if (!this.embeddingService.isAvailable()) {
      this.logger.debug("Embedding service unavailable, no knowledge base search");
      return { chunks: [] };
    }

    try {
      // Embed the query
      const queryEmbedding = await this.embeddingService.generate(input.queryText);
      if (!queryEmbedding) {
        this.logger.warn("Failed to embed query text");
        return { chunks: [] };
      }

      // Search knowledge base
      const chunks = await this.knowledgeRepo.similaritySearch(
        input.merchantId,
        queryEmbedding,
        input.limit ?? 5,
        input.threshold ?? 0.65
      );

      return { chunks };
    } catch (err) {
      this.logger.warn(`Knowledge base query failed: ${err instanceof Error ? err.message : String(err)}`);
      return { chunks: [] };
    }
  }
}
