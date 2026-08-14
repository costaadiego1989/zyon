/**
 * Embedding service re-export for storefront AI layer.
 *
 * The canonical embedding service lives in `catalog/infrastructure/services/embedding.service.ts`.
 * This module re-exports a pure-domain interface compatible with storefront's infrastructure/ai folder
 * without duplicating implementation or importing NestJS.
 *
 * Usage: For semantic search enrichment in intent classification or retrieval-augmented generation.
 */

export interface EmbeddingProvider {
  isAvailable(): boolean;
  generate(text: string): Promise<number[] | null>;
}

/**
 * Creates a lightweight embedding adapter from any service that implements EmbeddingProvider.
 *
 * In the storefront context, the CatalogModule's EmbeddingService is the canonical source.
 * Inject it via NestJS DI in the module wiring, not here.
 */
export function createEmbeddingAdapter(service: EmbeddingProvider): EmbeddingProvider {
  return {
    isAvailable: () => service.isAvailable(),
    generate: (text: string) => service.generate(text)
  };
}
