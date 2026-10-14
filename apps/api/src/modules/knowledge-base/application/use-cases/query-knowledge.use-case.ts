import { Injectable, Inject, Logger, Optional } from "@nestjs/common";
import { EMBEDDING_PORT, type EmbeddingPort } from "../../domain/ports/embedding.port.js";
import {
  KNOWLEDGE_REPOSITORY,
  type KnowledgeRepositoryPort,
  type KnowledgeChunk,
} from "../../domain/ports/knowledge-repository.port.js";
import { BillingPlanMeteringService } from "../../../payment/domain/billing-plan-guard.js";

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
    @Optional() private readonly billing?: BillingPlanMeteringService,
  ) {}

  async execute(input: QueryKnowledgeInput): Promise<QueryKnowledgeOutput> {
    // Queries run from buyer/support conversations, outside dashboard guards.
    // Keep indexed data for a possible upgrade, but fail closed on the feature.
    try {
      await this.billing?.assertAllowed(input.merchantId, { kind: "feature", key: "knowledgeBase" });
    } catch {
      return { chunks: [] };
    }
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
