import { Injectable, Logger } from "@nestjs/common";
import { generateDeterministicReply, generateSalesReply, classifyObjection } from "@zyon/conversation-engine";
import type { ConversationPort, ConversationReplyInput } from "../../domain/ports/conversation.port.js";

/**
 * Checkout conversation adapter — deterministic-first, LLM when user goes off-script.
 *
 * Flow:
 * 1. Classify if user message is a DATA RESPONSE (answering what was asked: CPF, phone, address, etc.)
 *    → If yes: deterministic reply (next step in checkout flow)
 * 2. If user goes OFF-SCRIPT (question, objection, complaint, negotiation)
 *    → LLM handles with merchant rules context
 *    → Try LOCAL Llama (Ollama) first, then DeepSeek cloud, then deterministic fallback
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
    const isOffScript = this.isOffScriptMessage(input);

    if (!isOffScript) {
      this.logger.debug("User responding to flow — deterministic");
      return generateDeterministicReply(input);
    }

    this.logger.log("User went off-script — routing to LLM");
    return this.callLlm(input);
  }

  /**
   * Detect if user message is OFF-SCRIPT (not answering a data collection question).
   * Off-script = questions, objections, complaints, negotiation attempts, unrelated topics.
   */
  private isOffScriptMessage(input: ConversationReplyInput): boolean {
    const msg = input.userMessage.toLowerCase().trim();

    // If no stage or no missing fields, always use LLM (free conversation)
    if (!input.stage || !input.missingFields?.length) return true;

    // Objection detected by conversation-engine classifier
    const objection = classifyObjection(input.userMessage);
    if (objection !== "unknown") return true;

    // Question patterns (Portuguese)
    const questionPatterns = [
      /\?$/,                          // ends with ?
      /^(quanto|qual|como|onde|quando|porque|por que|posso|pode|tem|existe|aceita)/i,
      /cupom|desconto|promoç|oferta|parcel/i,
      /frete.*caro|caro.*frete|frete.*alto/i,
      /troca|devolução|garantia|prazo/i,
      /não quero|não vou|desist/i,
      /ajuda|dúvida|pergunt/i,
      /pix|boleto|cartão|pagamento/i,
      /frete.*grát|grát.*frete|free.*ship/i,
    ];

    if (questionPatterns.some(p => p.test(msg))) return true;

    // If message is very short and looks like data (CPF, phone, email, CEP) → on-script
    const dataPatterns = [
      /^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/, // CPF
      /^\d{2}\s?\d{4,5}-?\d{4}$/,       // phone
      /^\d{5}-?\d{3}$/,                   // CEP
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/,      // email
      /^\d+$/,                            // just numbers (house number, etc)
      /^(sim|não|ok|certo|beleza|pode|vamos|bora)$/i, // confirmations
    ];

    if (dataPatterns.some(p => p.test(msg))) return false;

    // Default: if message is longer than 30 chars and doesn't match data → off-script
    if (msg.length > 30) return true;

    // Short message that doesn't match patterns → assume on-script (user typing name, address, etc)
    return false;
  }

  /**
   * Call LLM with fallback chain: Llama local → DeepSeek → deterministic
   */
  private async callLlm(input: ConversationReplyInput) {
    // Strategy 1: Local Llama via Ollama
    const localBaseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1";
    const localModel = process.env.OLLAMA_MODEL || "llama3.1:8b";

    try {
      const result = await generateSalesReply({
        ...input,
        apiKey: "ollama",
        baseUrl: localBaseUrl,
        model: localModel,
        provider: "openai_chat" as const,
        failOnProviderError: true,
      });
      this.logger.log(`Llama replied (${result.message.length} chars)`);
      return result;
    } catch (localErr: unknown) {
      this.logger.warn(`Llama failed: ${localErr instanceof Error ? localErr.message : String(localErr)}`);
    }

    // Strategy 2: DeepSeek cloud
    const cloudKey = process.env.DEEPSEEK_API_KEY;
    if (cloudKey) {
      try {
        const result = await generateSalesReply({
          ...input,
          apiKey: cloudKey,
          baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
          model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
          provider: "openai_chat" as const,
          failOnProviderError: true,
        });
        this.logger.log(`DeepSeek replied (${result.message.length} chars)`);
        return result;
      } catch (cloudErr: unknown) {
        this.logger.warn(`DeepSeek failed: ${cloudErr instanceof Error ? cloudErr.message : String(cloudErr)}`);
      }
    }

    // Strategy 3: Deterministic fallback
    this.logger.warn("All LLM providers failed — deterministic fallback");
    return generateDeterministicReply(input);
  }
}
