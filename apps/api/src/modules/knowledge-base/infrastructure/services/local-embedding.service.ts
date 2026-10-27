import { Injectable, Logger } from "@nestjs/common";
import type { EmbeddingPort } from "../../domain/ports/embedding.port.js";

/**
 * Local embedding provider — generates dense vectors offline via a quantized
 * sentence-transformer (all-MiniLM-L6-v2, 384 dims) running on onnxruntime.
 *
 * No API key, no network, no per-call cost. This is the default embedding
 * backend for the knowledge base so RAG works out of the box. The model
 * (~23 MB) downloads once on first use and is cached on disk thereafter.
 *
 * Contract: implements EmbeddingPort. generate() returns a 384-length vector,
 * or null if the model failed to load — callers degrade to keyword-only.
 */
@Injectable()
export class LocalEmbeddingService implements EmbeddingPort {
  private readonly logger = new Logger(LocalEmbeddingService.name);
  private readonly model = "Xenova/all-MiniLM-L6-v2";
  static readonly DIMENSION = 384;

  // Lazily-initialized feature-extraction pipeline. Loading is deferred to the
  // first generate() call so app boot stays fast and offline environments that
  // never touch RAG pay nothing.
  private extractorPromise: Promise<unknown> | null = null;
  private loadFailed = false;

  isAvailable(): boolean {
    // Availability is optimistic: the model loads on first use. Only after a
    // hard load failure do we report unavailable so callers stop trying.
    return !this.loadFailed;
  }

  private async getExtractor(): Promise<((text: string, opts: unknown) => Promise<{ data: Float32Array }>) | null> {
    if (this.loadFailed) return null;
    if (!this.extractorPromise) {
      this.extractorPromise = (async () => {
        // Dynamic import: keep the heavy ONNX runtime out of the module graph
        // until RAG is actually exercised.
        const { pipeline } = await import("@huggingface/transformers");
        this.logger.log(`Loading local embedding model ${this.model} (first use downloads ~23MB)…`);
        const extractor = await pipeline("feature-extraction", this.model);
        this.logger.log("Local embedding model ready");
        return extractor;
      })().catch((err) => {
        this.loadFailed = true;
        this.extractorPromise = null;
        this.logger.error(`Failed to load local embedding model: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      });
    }
    return this.extractorPromise as Promise<((text: string, opts: unknown) => Promise<{ data: Float32Array }>) | null>;
  }

  async generate(text: string): Promise<number[] | null> {
    const trimmed = text.slice(0, 8000);
    if (!trimmed.trim()) return null;

    try {
      const extractor = await this.getExtractor();
      if (!extractor) return null;

      // Mean pooling + normalization yields a single sentence vector suitable
      // for cosine similarity.
      const output = await extractor(trimmed, { pooling: "mean", normalize: true });
      return Array.from(output.data);
    } catch (err) {
      this.logger.error(`Local embedding generation failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}
