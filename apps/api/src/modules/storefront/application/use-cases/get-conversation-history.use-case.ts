/**
 * Get conversation history use-case.
 *
 * Retrieves message history for a storefront conversation.
 */

import { Injectable, Inject , Logger} from "@nestjs/common";
import { STOREFRONT_CONVERSATION_PORT, type StorefrontConversationPort } from "../../domain/ports/conversation.port.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

export interface GetConversationHistoryInput {
  merchant_id: string;
  conversation_id: string;
}

export interface GetConversationHistoryOutput {
  conversation_id: string;
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    timestamp?: string;
  }>;
}

@Injectable()
export class GetConversationHistoryUseCase {
  private readonly logger = new Logger(GetConversationHistoryUseCase.name);

  constructor(
    @Inject(STOREFRONT_CONVERSATION_PORT) private readonly conversation: StorefrontConversationPort
  ) {}

  async execute(input: GetConversationHistoryInput): Promise<GetConversationHistoryOutput> {
    // Placeholder: in production, this would fetch from a conversation history repo.
    // For now, return empty history.
    return {
      conversation_id: input.conversation_id,
      messages: []
    };
  }
}
