/**
 * OpenRouter provider — OpenAI-compatible HTTP client.
 *
 * OpenRouter exposes the OpenAI Chat Completions schema at
 * https://openrouter.ai/api/v1, so we use a small fetch-based client rather than
 * pulling in the heavy @langchain/openai surface. This keeps the conversation-
 * engine package framework-free (per CLAUDE.md rules: packages must not import
 * NestJS or framework code).
 *
 * Default model: `anthropic/claude-sonnet-4`. Configurable per merchant.
 */

export type OpenRouterRole = "system" | "user" | "assistant" | "tool";

export interface OpenRouterChatMessage {
  role: OpenRouterRole;
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface OpenRouterToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface OpenRouterChatRequest {
  messages: OpenRouterChatMessage[];
  tools?: OpenRouterToolDefinition[];
  toolChoice?: "auto" | "none" | { type: "function"; function: { name: string } };
  maxTokens?: number;
  temperature?: number;
  stop?: string[];
  model?: string;
}

export interface OpenRouterToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface OpenRouterChatResult {
  content: string;
  toolCalls?: OpenRouterToolCall[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface OpenRouterProviderOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  fetchFn?: typeof fetch;
  defaultMaxTokens?: number;
}

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "anthropic/claude-sonnet-4";

export class OpenRouterProvider {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
  private readonly fetchFn: typeof fetch;
  private readonly defaultMaxTokens: number;

  constructor(opts: OpenRouterProviderOptions) {
    if (!opts.apiKey || typeof opts.apiKey !== "string") {
      throw new Error("openrouter_provider: apiKey is required");
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.model = opts.model ?? DEFAULT_MODEL;
    this.fetchFn = opts.fetchFn ?? globalThis.fetch;
    this.defaultMaxTokens = opts.defaultMaxTokens ?? 500;
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

  async chat(request: OpenRouterChatRequest): Promise<OpenRouterChatResult> {
    if (!this.isAvailable()) {
      throw new Error("openrouter_provider: not available (missing apiKey)");
    }

    const body: Record<string, unknown> = {
      model: request.model || this.model,
      messages: request.messages.map((m) => {
        const msg: Record<string, unknown> = {
          role: m.role,
          content: m.content
        };
        if (m.name) msg.name = m.name;
        if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
        // Preserve tool_calls on assistant messages (required for tool result flow)
        if ((m as any).tool_calls) msg.tool_calls = (m as any).tool_calls;
        return msg;
      }),
      max_tokens: request.maxTokens ?? this.defaultMaxTokens,
      temperature: request.temperature ?? 0.5,
      stream: false
    };

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools;
      body.tool_choice = request.toolChoice ?? "auto";
    }

    if (request.stop && request.stop.length > 0) {
      body.stop = request.stop;
    }

    const response = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://zyon.ai",
        "X-Title": "AACP Checkout"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`openrouter_http_${response.status}: ${text.slice(0, 200)}`);
    }

    const json = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{
            id?: string;
            type?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const choice = json.choices?.[0];
    const message = choice?.message ?? {};
    const usage = json.usage ?? {};

    const toolCalls: OpenRouterToolCall[] | undefined = message.tool_calls
      ?.map((tc) => {
        if (!tc.function?.name) return null;
        let parsedArgs: Record<string, unknown> = {};
        try {
          const raw = tc.function.arguments ?? "{}";
          const obj = JSON.parse(raw);
          parsedArgs = typeof obj === "object" && obj !== null ? (obj as Record<string, unknown>) : {};
        } catch {
          parsedArgs = {};
        }
        return {
          id: tc.id ?? `call_${Math.random().toString(36).slice(2, 10)}`,
          name: tc.function.name,
          args: parsedArgs
        };
      })
      .filter((tc): tc is OpenRouterToolCall => tc !== null);

    return {
      content: typeof message.content === "string" ? message.content : "",
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens: usage.prompt_tokens ?? 0,
        completionTokens: usage.completion_tokens ?? 0,
        totalTokens: usage.total_tokens ?? 0
      }
    };
  }
}