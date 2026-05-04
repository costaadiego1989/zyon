import { Injectable } from "@nestjs/common";
import { generateSalesReply } from "@aacp/conversation-engine";
import type { ConversationPort } from "../../domain/ports/conversation.port.js";

@Injectable()
export class OpenAiConversationAdapter implements ConversationPort {
  reply(input: Parameters<ConversationPort["reply"]>[0]) {
    const deepSeekApiKey = process.env.DEEPSEEK_API_KEY;
    return generateSalesReply({
      ...input,
      provider: deepSeekApiKey ? "openai_chat" : "openai_responses",
      apiKey: deepSeekApiKey ?? process.env.OPENAI_API_KEY,
      baseUrl: deepSeekApiKey ? (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1") : process.env.OPENAI_BASE_URL,
      model: deepSeekApiKey ? (process.env.DEEPSEEK_MODEL ?? "deepseek-chat") : process.env.OPENAI_MODEL
    });
  }
}
