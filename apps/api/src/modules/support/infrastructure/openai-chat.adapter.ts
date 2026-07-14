/**
 * SUPP-H2: OpenAI implementation of ChatCompletionPort.
 * Encapsulates HTTP client, env reads, and error handling.
 */
import { Injectable, Optional } from "@nestjs/common";
import { HttpClientService } from "../../../shared/http/http-client.service.js";
import type { ChatCompletionPort, ChatMessage } from "../domain/ports/chat-completion.port.js";

@Injectable()
export class OpenAIChatAdapter implements ChatCompletionPort {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(@Optional() private readonly http?: HttpClientService) {
    this.apiKey = process.env.OPENAI_API_KEY ?? "";
    this.model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    this.baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  }

  get isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async complete(messages: ChatMessage[]): Promise<string | null> {
    if (!this.apiKey) return null;

    try {
      const fetchFn = this.http?.toFetch() ?? fetch;
      const response = await fetchFn(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          max_tokens: 300,
          temperature: 0.4,
        }),
      });

      if (!response.ok) return null;

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return data.choices?.[0]?.message?.content?.trim() ?? null;
    } catch {
      return null;
    }
  }
}
