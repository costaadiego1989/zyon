import { Injectable, Logger } from "@nestjs/common";

/**
 * Embedding service — generates text embeddings via OpenAI text-embedding-3-small.
 *
 * Produces 1536-dimensional vectors for semantic product search.
 * If OPENAI_API_KEY is not set, returns null so callers can fall back to ILIKE.
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly apiKey: string | undefined;
  private readonly model = "text-embedding-3-small";

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY;
    if (!this.apiKey) {
      this.logger.warn("OPENAI_API_KEY not set — semantic search disabled, falling back to ILIKE");
    }
  }

  /** Whether embedding generation is available */
  isAvailable(): boolean {
    return !!this.apiKey;
  }

  /**
   * Generate an embedding for the given text.
   * Returns null if OPENAI_API_KEY is not configured.
   */
  async generate(text: string): Promise<number[] | null> {
    if (!this.apiKey) return null;

    const trimmed = text.slice(0, 8000); // text-embedding-3-small context limit safety
    try {
      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: trimmed,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(`OpenAI embedding API error: ${response.status} — ${errorBody.slice(0, 200)}`);
        return null;
      }

      const data = (await response.json()) as {
        data: Array<{ embedding: number[] }>;
      };

      return data.data[0]?.embedding ?? null;
    } catch (err) {
      this.logger.error(`Embedding generation failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * Build searchable text content from product fields.
   * Concatenates name + description + variant attributes for indexing.
   */
  buildProductContent(product: {
    name: string;
    description?: string | null;
    variants?: Array<{ attributes?: Record<string, string> }>;
  }): string {
    const parts: string[] = [product.name];

    if (product.description) {
      parts.push(product.description);
    }

    if (product.variants?.length) {
      for (const variant of product.variants) {
        if (variant.attributes && typeof variant.attributes === "object") {
          const attrValues = Object.values(variant.attributes).filter(Boolean);
          if (attrValues.length) parts.push(attrValues.join(" "));
        }
      }
    }

    return parts.join(" | ");
  }
}
