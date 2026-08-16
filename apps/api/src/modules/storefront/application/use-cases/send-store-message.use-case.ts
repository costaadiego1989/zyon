/**
 * Send store message use-case.
 *
 * Receives user message, runs LangGraph agent with tools bound,
 * returns response message + conversation blocks.
 */

import { Injectable, Inject, NotFoundException, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import { STOREFRONT_CONVERSATION_PORT, type StorefrontConversationPort } from "../../domain/ports/conversation.port.js";
import { BUYER_CONVERSATION_REPOSITORY, type BuyerConversationRepository } from "../../../buyer-account/domain/ports/buyer-conversation.port.js";
import type { ConversationBlock } from "../../domain/types/conversation-block.js";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

export interface SendStoreMessageInput {
  merchant_id: string;
  conversation_id: string;
  user_message: string;
  cart_id?: string;
  global_user_id?: string;
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
    @Inject(STOREFRONT_CONVERSATION_PORT) private readonly conversation: StorefrontConversationPort,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Optional() @Inject(BUYER_CONVERSATION_REPOSITORY) private readonly conversationRepo?: BuyerConversationRepository
  ) {}

  async execute(input: SendStoreMessageInput): Promise<SendStoreMessageOutput> {
    const merchant = await this.merchant.getProfile(input.merchant_id);
    if (!merchant) throw new NotFoundException("merchant_not_found");

    const history = input.history ?? [];
    let storeSettings: Record<string, any> | undefined;
    try { storeSettings = await this.merchant.getStoreSettings(input.merchant_id) as any; } catch { /* optional */ }

    // Load agent identity from agent_rules (source of truth for agent name/persona/tone)
    let agentIdentity: { agentName?: string; persona?: string; tone?: string; greeting?: string } | undefined;
    try {
      const agentRule = await this.prisma.agentRule.findFirst({
        where: { merchantId: input.merchant_id },
        select: { identity: true },
      });
      const identity = agentRule?.identity as { agentName?: string; persona?: string; tone?: string; greeting?: string } | null;
      if (identity) agentIdentity = identity;
    } catch { /* optional — fallback to no identity */ }

    const result = await this.conversation.reply({
      userMessage: input.user_message,
      cartId: input.cart_id,
      merchantId: input.merchant_id,
      sessionId: input.conversation_id,
      history,
      merchantName: merchant.name,
      storeCategory: merchant.storeCategory || "others",
      storeSettings,
      agentIdentity
    });

    // Persist conversation history (non-blocking, best-effort)
    if (this.conversationRepo && input.global_user_id) {
      try {
        const now = new Date();
        await this.conversationRepo.upsertConversation({
          globalUserId: input.global_user_id,
          sessionId: input.conversation_id,
          merchantId: input.merchant_id,
          message: {
            id: randomUUID(),
            role: "buyer",
            content: input.user_message,
            createdAt: now,
            rating: null
          }
        });
        await this.conversationRepo.upsertConversation({
          globalUserId: input.global_user_id,
          sessionId: input.conversation_id,
          merchantId: input.merchant_id,
          message: {
            id: randomUUID(),
            role: "agent",
            content: result.message,
            createdAt: new Date(),
            rating: null
          }
        });
      } catch {
        // Conversation persistence is best-effort; never block storefront flow
      }
    }

    return {
      message: result.message,
      blocks: result.blocks,
      cart_id: result.cartId,
      conversation_id: input.conversation_id
    };
  }
}
