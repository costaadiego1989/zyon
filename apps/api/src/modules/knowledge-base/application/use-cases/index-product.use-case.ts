import { Injectable, Inject, Logger } from "@nestjs/common";
import { EmbeddingService } from "../../../catalog/infrastructure/services/embedding.service.js";
import { KNOWLEDGE_REPOSITORY, type KnowledgeRepositoryPort } from "../../domain/ports/knowledge-repository.port.js";

export interface IndexProductInput {
  merchantId: string;
  productId: string;
  name: string;
  description?: string | null;
  variants?: Array<{
    sku?: string;
    attributes?: Record<string, string>;
  }>;
  priceCents?: number;
  quantity?: number;
}

@Injectable()
export class IndexProductUseCase {
  private readonly logger = new Logger(IndexProductUseCase.name);

  constructor(
    private readonly embeddingService: EmbeddingService,
    @Inject(KNOWLEDGE_REPOSITORY) private readonly knowledgeRepo: KnowledgeRepositoryPort,
  ) {}

  async execute(input: IndexProductInput): Promise<void> {
    if (!this.embeddingService.isAvailable()) {
      this.logger.debug("Embedding service unavailable, skipping product indexing");
      return;
    }

    try {
      // Build searchable text content
      const content = this.buildProductContent(input);

      // Generate embedding
      const embedding = await this.embeddingService.generate(content);
      if (!embedding) {
        this.logger.warn(`Failed to generate embedding for product ${input.productId}`);
        return;
      }

      // Upsert to knowledge base
      await this.knowledgeRepo.upsertChunks(
        input.merchantId,
        "product",
        input.productId,
        [
          {
            content,
            embedding,
            metadata: {
              productId: input.productId,
              name: input.name,
              price: input.priceCents,
              quantity: input.quantity,
            },
          },
        ]
      );

      this.logger.debug(`Indexed product ${input.productId} for merchant ${input.merchantId}`);
    } catch (err) {
      this.logger.warn(
        `Failed to index product ${input.productId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private buildProductContent(input: IndexProductInput): string {
    const parts: string[] = [input.name];

    if (input.description) {
      parts.push(input.description);
    }

    if (input.variants?.length) {
      for (const variant of input.variants) {
        if (variant.sku) parts.push(`SKU: ${variant.sku}`);
        if (variant.attributes && typeof variant.attributes === "object") {
          const attrValues = Object.entries(variant.attributes)
            .map(([key, val]) => `${key}: ${val}`)
            .filter(Boolean);
          if (attrValues.length) parts.push(attrValues.join(" | "));
        }
      }
    }

    if (input.priceCents) {
      parts.push(`Preço: R$ ${(input.priceCents / 100).toFixed(2)}`);
    }

    if (input.quantity !== undefined) {
      parts.push(`Estoque: ${input.quantity} unidades`);
    }

    return parts.join(" | ");
  }
}
