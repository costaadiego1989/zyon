/**
 * Embedding Service — calls OpenRouter embeddings API for merchant config documents.
 *
 * Model: openai/text-embedding-3-small (1536 dimensions).
 *
 * On any failure (missing key, network error, non-2xx) the service returns null.
 * Callers MUST treat null as "embedding unavailable, fall back to raw text".
 */

export interface EmbeddingResult {
  vector: number[]; // 1536 dimensions
  model: string;
  tokensUsed: number;
}

export interface EmbeddingServiceOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export interface EmbeddingServicePort {
  embed(text: string): Promise<EmbeddingResult | null>;
}

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "openai/text-embedding-3-small";
const DEFAULT_TIMEOUT_MS = 5_000;

export class EmbeddingService implements EmbeddingServicePort {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: EmbeddingServiceOptions) {
    this.apiKey = opts.apiKey ?? "";
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.model = opts.model ?? DEFAULT_MODEL;
    this.fetchFn = opts.fetchFn ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey && this.apiKey.length > 0);
  }

  async embed(text: string): Promise<EmbeddingResult | null> {
    if (!this.isAvailable()) {
      return null;
    }
    if (!text || text.length === 0) {
      return null;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await this.fetchFn(`${this.baseUrl}/embeddings`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://zyon.ai",
            "X-Title": "AACP Checkout"
          },
          body: JSON.stringify({
            model: this.model,
            input: text
          }),
          signal: controller.signal
        });

        if (!response.ok) {
          return null;
        }

        const json = (await response.json()) as {
          data?: Array<{ embedding?: number[] }>;
          model?: string;
          usage?: { prompt_tokens?: number; total_tokens?: number };
        };

        const vector = json.data?.[0]?.embedding ?? [];
        const model = json.model ?? this.model;
        const tokensUsed = json.usage?.total_tokens ?? json.usage?.prompt_tokens ?? 0;

        if (vector.length === 0) {
          return null;
        }

        return { vector, model, tokensUsed };
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // Graceful degradation: any failure returns null.
      return null;
    }
  }
}
