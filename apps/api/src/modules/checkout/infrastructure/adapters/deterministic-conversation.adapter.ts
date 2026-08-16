import { Injectable, Logger } from "@nestjs/common";
import { generateDeterministicReply, generateSalesReply } from "@zyon/conversation-engine";
import type { ConversationPort, ConversationReplyInput } from "../../domain/ports/conversation.port.js";

/**
 * Checkout conversation adapter — hybrid LLM strategy:
 *
 * 1. Try LOCAL Llama (Ollama) — fast, free, no rate limits
 * 2. Fallback to DeepSeek cloud — if local unavailable
 * 3. Last resort: deterministic reply — if all LLM providers fail
 *
 * Env vars:
 *   OLLAMA_BASE_URL    (default: http://localhost:11434/v1)
 *   OLLAMA_MODEL       (default: llama3.2)
 *   DEEPSEEK_API_KEY   (cloud fallback)
 *   DEEPSEEK_BASE_URL  (default: https://api.deepseek.com/v1)
 *   DEEPSEEK_MODEL     (default: deepseek-chat)
 */
@Injectable()
export class DeterministicConversationAdapter implements ConversationPort {
  private readonly logger = new Logger(DeterministicConversationAdapter.name);

  async reply(input: ConversationReplyInput) {
    // Strategy 1: Local Llama via Ollama (OpenAI-compatible API)
    const localBaseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1";
    const localModel = process.env.OLLAMA_MODEL || "llama3.2";

    try {
      const result = await generateSalesReply({
        ...input,
        apiKey: "ollama", // Ollama doesn't need real key but field is required
        baseUrl: localBaseUrl,
        model: localModel,
        provider: "openai_chat" as const,
        failOnProviderError: true,
      });
      this.logger.log(`Llama local replied (${result.message.length} chars)`);
      return result;
    } catch (localErr: unknown) {
      this.logger.warn(`Local Llama failed: ${localErr instanceof Error ? localErr.message : String(localErr)}`);
    }

    // Strategy 2: DeepSeek cloud fallback
    const cloudKey = process.env.DEEPSEEK_API_KEY;
    if (cloudKey) {
      const cloudBaseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1";
      const cloudModel = process.env.DEEPSEEK_MODEL || "deepseek-chat";

      try {
        const result = await generateSalesReply({
          ...input,
          apiKey: cloudKey,
          baseUrl: cloudBaseUrl,
          model: cloudModel,
          provider: "openai_chat" as const,
          failOnProviderError: true,
        });
        this.logger.log(`DeepSeek cloud replied (${result.message.length} chars)`);
        return result;
      } catch (cloudErr: unknown) {
        this.logger.warn(`DeepSeek cloud failed: ${cloudErr instanceof Error ? cloudErr.message : String(cloudErr)}`);
      }
    }

    // Strategy 3: Deterministic fallback
    this.logger.warn("All LLM providers unavailable — using deterministic reply");
    return generateDeterministicReply(input);
  }
}
