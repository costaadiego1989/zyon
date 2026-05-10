import { Injectable, Optional } from "@nestjs/common";
import { generateSalesReply } from "@aacp/conversation-engine";
import type { ConversationPort, ConversationReplyInput } from "../../domain/ports/conversation.port.js";
import { HttpClientService } from "../../../../shared/http/http-client.service.js";

@Injectable()
export class OpenAiConversationAdapter implements ConversationPort {
  constructor(@Optional() private readonly http?: HttpClientService) {}

  reply(input: ConversationReplyInput) {
    const deepSeekApiKey = process.env.DEEPSEEK_API_KEY;
    return generateSalesReply({
      ...input,
      provider: deepSeekApiKey ? "openai_chat" : "openai_responses",
      apiKey: deepSeekApiKey ?? process.env.OPENAI_API_KEY,
      baseUrl: deepSeekApiKey
        ? (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1")
        : process.env.OPENAI_BASE_URL,
      model: deepSeekApiKey ? (process.env.DEEPSEEK_MODEL ?? "deepseek-chat") : process.env.OPENAI_MODEL,
      fetchFn: this.http?.toFetch(),
    });
  }
}
