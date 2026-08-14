import { Injectable, Inject } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { ProductRepositoryPort, SearchProductsInput, SearchProductsResult } from "../../domain/ports/product-repository.port.js";
import { EmbeddingService } from "../../infrastructure/services/embedding.service.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

interface VectorSearchRow {
  product_id: string;
  similarity: number;
}

@Injectable()
export class SearchProductsUseCase {
  constructor(
    @Inject("ProductRepositoryPort") private readonly productRepo: ProductRepositoryPort,
    private readonly embeddingService: EmbeddingService,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  async execute(input: SearchProductsInput): Promise<SearchProductsResult> {
    const limit = Math.min(input.limit ?? 20, 100);

    // If no query or embeddings unavailable, use standard ILIKE search
    if (!input.query || !this.embeddingService.isAvailable()) {
      return this.productRepo.search({ ...input, limit });
    }

    // Hybrid search: combine vector similarity + ILIKE results
    const [vectorResults, ilikeResults] = await Promise.all([
      this.vectorSearch(input.merchantId, input.query, limit),
      this.productRepo.search({ ...input, limit }),
    ]);

    if (!vectorResults.length) {
      return ilikeResults;
    }

    // Merge: vector results first (by similarity), then ILIKE results not already included
    const vectorProductIds = new Set(vectorResults.map((r) => r.product_id));
    const mergedIds = [...vectorResults.map((r) => r.product_id)];

    for (const product of ilikeResults.products) {
      if (!vectorProductIds.has(product.id)) {
        mergedIds.push(product.id);
      }
    }

    // Trim to limit
    const finalIds = mergedIds.slice(0, limit);

    // Fetch full products in order — reuse what we already have from ILIKE
    const ilikeMap = new Map(ilikeResults.products.map((p) => [p.id, p]));
    const orderedProducts = [];

    for (const id of finalIds) {
      const existing = ilikeMap.get(id);
      if (existing) {
        orderedProducts.push(existing);
      } else {
        const fetched = await this.productRepo.findById(input.merchantId, id);
        if (fetched) orderedProducts.push(fetched);
      }
    }

    return {
      products: orderedProducts,
      nextCursor: ilikeResults.nextCursor,
      total: Math.max(ilikeResults.total, orderedProducts.length),
    };
  }

  /**
   * Perform cosine similarity search against product_search_vectors via raw SQL.
   * Returns product IDs ranked by similarity score.
   */
  private async vectorSearch(
    merchantId: string,
    query: string,
    limit: number,
  ): Promise<VectorSearchRow[]> {
    try {
      const embedding = await this.embeddingService.generate(query);
      if (!embedding) return [];

      const embeddingStr = `[${embedding.join(",")}]`;

      const rows = await (this.prisma as any).$queryRaw`
        SELECT product_id, 1 - (embedding <=> ${embeddingStr}::vector) AS similarity
        FROM product_search_vectors
        WHERE merchant_id = ${merchantId}
          AND embedding IS NOT NULL
        ORDER BY embedding <=> ${embeddingStr}::vector
        LIMIT ${limit}
      `;

      return (rows as VectorSearchRow[]).filter((r) => r.similarity > 0.3);
    } catch {
      // pgvector extension may not be installed or table empty — graceful fallback
      return [];
    }
  }
}
