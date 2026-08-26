import { Injectable, Inject, Logger } from "@nestjs/common";
import type { SupportFaqItem } from "@zyon/shared-types";
import { EmbeddingService } from "../../../catalog/infrastructure/services/embedding.service.js";
import { KNOWLEDGE_REPOSITORY, type KnowledgeRepositoryPort } from "../../domain/ports/knowledge-repository.port.js";

export interface IndexFaqInput {
  merchantId: string;
  faqItems: SupportFaqItem[];
}

@Injectable()
export class IndexFaqUseCase {
  private readonly logger = new Logger(IndexFaqUseCase.name);

  constructor(
    private readonly embeddingService: EmbeddingService,
    @Inject(KNOWLEDGE_REPOSITORY) private readonly knowledgeRepo: KnowledgeRepositoryPort,
  ) {}

  async execute(input: IndexFaqInput): Promise<void> {
    if (!this.embeddingService.isAvailable()) {
      this.logger.debug("Embedding service unavailable, skipping FAQ indexing");
      return;
    }

    if (!input.faqItems?.length) {
      // Clear existing FAQ entries if no items
      await this.knowledgeRepo.deleteBySource(input.merchantId, "faq", "faq-collection");
      return;
    }

    try {
      const chunks: Array<{
        content: string;
        embedding: number[];
        metadata?: Record<string, unknown>;
      }> = [];

      // Generate embeddings for each FAQ item
      for (const item of input.faqItems) {
        const content = `P: ${item.question}\nR: ${item.answer}`;
        const embedding = await this.embeddingService.generate(content);

        if (embedding) {
          chunks.push({
            content,
            embedding,
            metadata: {
              question: item.question,
              itemId: item.id ?? item.question,
            },
          });
        }
      }

      if (chunks.length === 0) {
        this.logger.warn("No FAQ items could be embedded");
        return;
      }

      // Upsert all FAQ chunks
      await this.knowledgeRepo.upsertChunks(input.merchantId, "faq", "faq-collection", chunks);

      this.logger.debug(`Indexed ${chunks.length} FAQ items for merchant ${input.merchantId}`);
    } catch (err) {
      this.logger.warn(`Failed to index FAQ: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
