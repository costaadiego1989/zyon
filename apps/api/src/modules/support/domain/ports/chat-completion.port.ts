/**
 * SUPP-H2: ChatCompletionPort — abstracts LLM dependency behind a domain port.
 * Production: OpenAI adapter. Tests: test double.
 */
export const CHAT_COMPLETION_PORT = Symbol("CHAT_COMPLETION_PORT");

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionPort {
  complete(messages: ChatMessage[]): Promise<string | null>;
}
