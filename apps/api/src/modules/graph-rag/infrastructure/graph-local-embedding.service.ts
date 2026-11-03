import { createHash } from "node:crypto";
import { graphReadSchema, GRAPH_VECTOR_DIMENSIONS } from "../domain/graph-query.js";
import type { GraphEmbeddingPort } from "../domain/graph-rag.port.js";

import { GRAPH_EMBEDDING_MODEL, GRAPH_EMBEDDING_REVISION, GRAPH_EMBEDDING_ID } from "../domain/graph-embedding-model.js";
export { GRAPH_EMBEDDING_MODEL, GRAPH_EMBEDDING_REVISION, GRAPH_EMBEDDING_ID } from "../domain/graph-embedding-model.js";
type Extractor = (text: string) => Promise<number[]>;
export type GraphExtractorLoader = () => Promise<Extractor>;
const defaultLoader: GraphExtractorLoader = async () => {
  const { pipeline } = await import("@huggingface/transformers");
  const extractor = await pipeline("feature-extraction", GRAPH_EMBEDDING_MODEL,
    { revision: GRAPH_EMBEDDING_REVISION, dtype: "q8" });
  return async text => {
    const result = await extractor(text, { pooling: "mean", normalize: true });
    return Array.from(result.data, value => Number(value));
  };
};

/** A separate, versioned multilingual index. Existing PostgreSQL embeddings
 * retain their original model. First use downloads public model artifacts;
 * subsequent inference uses the local model cache and requires no API key. */
export class GraphLocalEmbeddingService implements GraphEmbeddingPort {
  readonly modelId = GRAPH_EMBEDDING_ID;
  readonly dimensions = GRAPH_VECTOR_DIMENSIONS;
  private extractor?: Promise<Extractor>;
  private readonly cache = new Map<string, number[]>();
  private readonly pending = new Map<string, Promise<number[] | null>>();
  private failedAt?: number;
  constructor(private readonly loader: GraphExtractorLoader = defaultLoader, private readonly cacheLimit = 256,
    private readonly clock: () => number = Date.now) {}

  async generate(value: string): Promise<number[] | null> {
    const text = value.trim().slice(0, 8000);
    if (!text || this.failedAt !== undefined && this.clock() - this.failedAt < 60_000) return null;
    const key = createHash("sha256").update(this.modelId + "\0" + text).digest("hex");
    const cached = this.cache.get(key);
    if (cached) { this.cache.delete(key);this.cache.set(key, cached);return [...cached]; }
    let inference = this.pending.get(key);
    if (!inference) {
      inference = (async () => {
        try {
          this.extractor ??= Promise.resolve().then(() => this.loader());
          const extractor = await this.extractor, vector = graphReadSchema.shape.embedding.safeParse(await extractor(text));
          if (!vector.success) return null;
          this.cache.set(key, vector.data);
          if (this.cache.size > this.cacheLimit) this.cache.delete(this.cache.keys().next().value!);
          this.failedAt = undefined;
          return vector.data;
        } catch { this.failedAt = this.clock();this.extractor = undefined;return null; }
        finally { this.pending.delete(key); }
      })();
      this.pending.set(key, inference);
    }
    const result = await inference;
    return result ? [...result] : null;
  }
}
