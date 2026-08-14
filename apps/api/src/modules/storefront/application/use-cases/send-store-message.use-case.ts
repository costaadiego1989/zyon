/**
 * Send store message use-case.
 *
 * Receives user message, runs LangGraph agent with tools bound,
 * returns response message + conversation blocks.
 */

import { Injectable, Inject, NotFoundException } from "@nestjs/common";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import { STOREFRONT_CONVERSATION_PORT, type StorefrontConversationPort } from "../../domain/ports/conversation.port.js";
import type { ConversationBlock } from "../../domain/types/conversation-block.js";

export interface SendStoreMessageInput {
  merchant_id: string;
  conversation_id: string;
  user_message: string;
  cart_id?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface SendStoreMessageOutput {
  message: string;
  blocks: ConversationBlock[];
  cart_id?: string;
  conversation_id: string;
}

@Injectable()
export class SendStoreMessageUseCase {
  constructor(
    @Inject(MERCHANT_REPOSITORY) private readonly merchant: MerchantRepository,
    @Inject(STOREFRONT_CONVERSATION_PORT) private readonly conversation: StorefrontConversationPort
  ) {}

  async execute(input: SendStoreMessageInput): Promise<SendStoreMessageOutput> {
    const merchant = await this.merchant.getProfile(input.merchant_id);
    if (!merchant) throw new NotFoundException("merchant_not_found");

    const history = input.history ?? [];

    const result = await this.conversation.reply({
      userMessage: input.user_message,
      cartId: input.cart_id,
      merchantId: input.merchant_id,
      sessionId: input.conversation_id,
      history,
      merchantName: merchant.name
    });

    return {
      message: result.message,
      blocks: result.blocks,
      cart_id: result.cartId,
      conversation_id: input.conversation_id
    };
  }
}
