export interface LocalLLMChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LocalLLMChatRequest {
  messages: LocalLLMChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stop?: string[];
}

export interface LocalLLMChatResult {
  content: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface LocalLLMProviderOptions {
  baseUrl?: string;
  model?: string;
  fetchFn?: typeof fetch;
  timeout?: number;
}

const DEFAULT_BASE_URL = "http://localhost:11434/v1";
const DEFAULT_MODEL = "mistral";
const DEFAULT_TIMEOUT_MS = 5000;

export class LocalLLMProvider {
  readonly baseUrl: string;
  readonly model: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: LocalLLMProviderOptions = {}) {
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

  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await this.fetchFn(`${this.baseUrl}/models`, {
        method: "GET",
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }

  async chat(request: LocalLLMChatRequest): Promise<LocalLLMChatResult | null> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      const body: Record<string, unknown> = {
        model: this.model,
        messages: request.messages.map((m) => ({
          role: m.role,
          content: m.content
        })),
        temperature: request.temperature ?? 0.7,
        max_tokens: request.max_tokens ?? 500,
        stream: false
      };

      if (request.stop && request.stop.length > 0) {
        body.stop = request.stop;
      }

      const response = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        console.warn(`Local LLM HTTP ${response.status}: ${text.slice(0, 100)}`);
        return null;
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
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`Local LLM call failed: ${msg}`);
      return null;
    }
  }
}
