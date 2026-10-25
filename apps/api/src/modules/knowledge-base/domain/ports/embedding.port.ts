export const EMBEDDING_PORT = Symbol("EMBEDDING_PORT");

/**
 * Generates dense vector embeddings for a text input.
 * Returns null when embedding generation is unavailable (e.g. missing API key),
 * allowing callers to degrade gracefully to keyword-only indexing.
 */
export interface EmbeddingPort {
  isAvailable(): boolean;
  generate(text: string): Promise<number[] | null>;
}
