import { Injectable, Logger } from "@nestjs/common";
import { generateDeterministicReply, generateSalesReply } from "@zyon/conversation-engine";
import type { ConversationPort, ConversationReplyInput } from "../../domain/ports/conversation.port.js";

@Injectable()
export class DeterministicConversationAdapter implements ConversationPort {
  private readonly logger = new Logger(DeterministicConversationAdapter.name);

  async reply(input: ConversationReplyInput) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    const baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1";
    const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";

    if (!apiKey) {
      return generateDeterministicReply(input);
    }

    try {
      const result = await generateSalesReply({
        ...input,
        apiKey,
        baseUrl,
        model,
        provider: "openai_chat" as const,
        failOnProviderError: true,
      });
      this.logger.log(`LLM replied (${result.message.length} chars)`);
      return result;
    } catch (e: unknown) {
      this.logger.warn(`LLM call failed: ${e instanceof Error ? e.message : String(e)}`);
      return generateDeterministicReply(input);
    }
  }
}
