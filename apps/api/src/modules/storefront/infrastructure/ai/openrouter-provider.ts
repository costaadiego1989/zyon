/**
 * OpenAI provider wrapper for storefront.
 *
 * Wraps OpenAI API (gpt-4o-mini) with standard chat completion interface.
 * Env: OPENAI_API_KEY
 * Returns token count for budget tracking.
 *
 * Framework-free (no NestJS imports) — suitable for use in domain/packages.
 */

export interface OpenAIChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenAIChatRequest {
  messages: OpenAIChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stop?: string[];
}

export interface OpenAIChatResult {
  content: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenRouterProviderOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  fetchFn?: typeof fetch;
  timeout?: number;
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TIMEOUT_MS = 30000; // 30s for OpenAI

export class OpenRouterProvider {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: OpenRouterProviderOptions) {
    // Accept empty apiKey — isAvailable() will return false.
    this.apiKey = opts.apiKey || "";
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.model = opts.model ?? DEFAULT_MODEL;
    this.fetchFn = opts.fetchFn ?? globalThis.fetch;
    this.timeoutMs = opts.timeout ?? DEFAULT_TIMEOUT_MS;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getModel(): string {
    return this.model;
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey && this.apiKey.length > 0);
  }

  /**
   * Call OpenAI API with timeout.
   */
  async chat(request: OpenAIChatRequest): Promise<OpenAIChatResult> {
    if (!this.isAvailable()) {
      throw new Error("openrouter_provider: not available (missing apiKey)");
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    const body: Record<string, unknown> = {
      model: this.model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content
      })),
      temperature: request.temperature ?? 0.7,
      max_tokens: request.max_tokens ?? 500
    };

    if (request.stop && request.stop.length > 0) {
      body.stop = request.stop;
    }

    try {
      const response = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": "Zyon-Storefront/1.0"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`openai_http_${response.status}: ${text.slice(0, 200)}`);
      }

      const json = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: string;
          };
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      };

      const choice = json.choices?.[0];
      const message = choice?.message ?? {};
      const usage = json.usage ?? {};

      return {
        content: typeof message.content === "string" ? message.content : "",
        usage: {
          prompt_tokens: usage.prompt_tokens ?? 0,
          completion_tokens: usage.completion_tokens ?? 0,
          total_tokens: usage.total_tokens ?? 0
        }
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("openai_timeout");
      }
      throw error;
    }
  }
}
