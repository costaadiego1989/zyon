import { Injectable, Inject, Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { EmbeddingService } from "../../infrastructure/services/embedding.service.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

export interface IndexProductEmbeddingInput {
  merchantId: string;
  productId: string;
  name: string;
  description?: string | null;
  variants?: Array<{ attributes?: Record<string, string> }>;
}

/**
 * Index a product's embedding into the ProductSearchVector table.
 * Called after product create/update to keep semantic search index fresh.
 *
 * If embedding service is unavailable (no OPENAI_API_KEY), this is a no-op.
 */
@Injectable()
export class IndexProductEmbeddingUseCase {
  private readonly logger = new Logger(IndexProductEmbeddingUseCase.name);

  constructor(
    private readonly embeddingService: EmbeddingService,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  async execute(input: IndexProductEmbeddingInput): Promise<void> {
    if (!this.embeddingService.isAvailable()) {
      return;
    }

    const content = this.embeddingService.buildProductContent({
      name: input.name,
      description: input.description,
      variants: input.variants,
    });

    const embedding = await this.embeddingService.generate(content);
    if (!embedding) {
      this.logger.warn(`Failed to generate embedding for product ${input.productId}`);
      return;
    }

    try {
      const embeddingStr = `[${embedding.join(",")}]`;

      // Upsert: insert or update the vector row via raw SQL (Prisma can't handle vector type)
      await (this.prisma as any).$executeRaw`
        INSERT INTO product_search_vectors (id, product_id, merchant_id, embedding, content, updated_at)
        VALUES (
          gen_random_uuid()::text,
          ${input.productId},
          ${input.merchantId},
          ${embeddingStr}::vector,
          ${content},
          NOW()
        )
        ON CONFLICT (product_id) DO UPDATE SET
          embedding = ${embeddingStr}::vector,
          content = ${content},
          updated_at = NOW()
      `;

      this.logger.debug(`Indexed embedding for product ${input.productId}`);
    } catch (err) {
      // Non-fatal: pgvector might not be installed, or table doesn't exist yet
      this.logger.warn(
        `Failed to index embedding for product ${input.productId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
