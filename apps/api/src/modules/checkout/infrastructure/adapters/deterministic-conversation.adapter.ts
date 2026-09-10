import { Injectable, Logger } from "@nestjs/common";
import { generateDeterministicReply } from "@zyon/conversation-engine";
import type { ConversationPort, ConversationReplyInput } from "../../domain/ports/conversation.port.js";

/**
 * Checkout conversation fallback — deterministic templates only.
 *
 * LLM path for checkout lives in ChatLlmGatewayService (SendChatMessageUseCase).
 * This adapter must NOT call providers (Ollama/DeepSeek/OpenAI) — that dual stack
 * caused divergent safety/env behavior when the gateway failed or was skipped.
 *
 * Off-script / objection copy still comes from generateDeterministicReply
 * (classifyObjection + safe templates + authorizedOffer).
 */
@Injectable()
export class DeterministicConversationAdapter implements ConversationPort {
  private readonly logger = new Logger(DeterministicConversationAdapter.name);

  async reply(input: ConversationReplyInput) {
    this.logger.debug(
      `[deterministic] msg="${input.userMessage.slice(0, 40)}" stage=${input.stage} missing=${input.missingFields?.join(",")}`,
    );
    const reply = generateDeterministicReply(input);
    const agentName = input.agentContext?.agent.agentName?.trim();
    if (!agentName || reply.message.startsWith(`${agentName}:`)) return reply;
    return { ...reply, message: `${agentName}: ${reply.message}` };
  }
}
