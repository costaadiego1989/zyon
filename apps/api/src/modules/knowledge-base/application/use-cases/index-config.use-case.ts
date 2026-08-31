import { Injectable, Logger, Inject } from "@nestjs/common";
import { KNOWLEDGE_REPOSITORY, type KnowledgeRepositoryPort } from "../../domain/ports/knowledge-repository.port.js";
import { EMBEDDING_PORT, type EmbeddingPort } from "../../domain/ports/embedding.port.js";

export interface IndexConfigInput {
  merchantId: string;
  paymentMethods?: string[];
  deliveryRegions?: string[];
  installments?: string[];
}

/**
 * Indexes merchant store configuration as knowledge chunks.
 * Builds a human-readable text summary of payment methods, shipping regions, and installment options.
 * Embeds and stores as a single "config" chunk so support chat can reference store capabilities.
 */
@Injectable()
export class IndexConfigUseCase {
  private readonly logger = new Logger(IndexConfigUseCase.name);

  constructor(
    @Inject(KNOWLEDGE_REPOSITORY) private readonly knowledgeRepository: KnowledgeRepositoryPort,
    @Inject(EMBEDDING_PORT) private readonly embeddingService: EmbeddingPort,
  ) {}

  async execute(input: IndexConfigInput): Promise<void> {
    const { merchantId, paymentMethods, deliveryRegions, installments } = input;

    // Build human-readable content
    const contentParts: string[] = [];

    if (paymentMethods?.length) {
      contentParts.push(`Formas de pagamento aceitas: ${paymentMethods.join(", ")}.`);
    }

    if (installments?.length) {
      contentParts.push(`Parcelamento: ${installments.join(", ")}.`);
    }

    if (deliveryRegions?.length) {
      contentParts.push(`Regiões de entrega: ${deliveryRegions.join(", ")}.`);
    }

    if (!contentParts.length) {
      this.logger.debug(`No config data to index for merchant ${merchantId}`);
      return;
    }

    const content = contentParts.join(" ");

    // Generate embedding
    const embedding = await this.embeddingService.generate(content);
    if (!embedding) {
      this.logger.warn(`Embedding generation failed for store config on merchant ${merchantId}`);
      return;
    }

    // Upsert as "config" source
    try {
      await this.knowledgeRepository.upsertChunks(merchantId, "config", "store-config", [
        {
          content,
          embedding,
          metadata: {
            paymentMethods: paymentMethods ?? [],
            deliveryRegions: deliveryRegions ?? [],
            installments: installments ?? [],
            indexedAt: new Date().toISOString(),
          },
        },
      ]);

      this.logger.debug(`Indexed store config for merchant ${merchantId}`);
    } catch (err) {
      this.logger.error(
        `Failed to index config for merchant ${merchantId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }
}
