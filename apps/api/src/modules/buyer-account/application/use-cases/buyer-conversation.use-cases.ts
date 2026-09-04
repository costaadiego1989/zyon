import { Inject, Injectable } from "@nestjs/common";
import {
  BUYER_CONVERSATION_REPOSITORY,
  type BuyerConversation,
  type BuyerConversationRepository,
} from "../../domain/ports/buyer-conversation.port.js";

@Injectable()
export class ListBuyerConversationsUseCase {
  constructor(
    @Inject(BUYER_CONVERSATION_REPOSITORY) private readonly repo: BuyerConversationRepository
  ) {}

  async execute(input: { globalUserId: string }): Promise<BuyerConversation[]> {
    if (!input.globalUserId) throw new Error("buyer_conversation_missing_global_user_id");
    return this.repo.listByBuyer(input.globalUserId);
  }
}

@Injectable()
export class GetBuyerConversationUseCase {
  constructor(
    @Inject(BUYER_CONVERSATION_REPOSITORY) private readonly repo: BuyerConversationRepository
  ) {}

  async execute(input: { globalUserId: string; id: string }): Promise<BuyerConversation> {
    if (!input.globalUserId) throw new Error("buyer_conversation_missing_global_user_id");
    if (!input.id) throw new Error("buyer_conversation_missing_id");
    const c = await this.repo.findById(input.globalUserId, input.id);
    if (!c) throw new Error("buyer_conversation_not_found");
    return c;
  }
}

@Injectable()
export class RateBuyerConversationMessageUseCase {
  constructor(
    @Inject(BUYER_CONVERSATION_REPOSITORY) private readonly repo: BuyerConversationRepository
  ) {}

  async execute(input: {
    globalUserId: string;
    conversationId: string;
    messageId: string;
    rating: "up" | "down";
  }): Promise<void> {
    if (!input.globalUserId) throw new Error("buyer_conversation_missing_global_user_id");
    if (!input.conversationId) throw new Error("buyer_conversation_missing_id");
    if (!input.messageId) throw new Error("buyer_conversation_missing_message_id");
    if (input.rating !== "up" && input.rating !== "down") {
      throw new Error("buyer_conversation_invalid_rating");
    }
    await this.repo.rateMessage(input);
  }
}
