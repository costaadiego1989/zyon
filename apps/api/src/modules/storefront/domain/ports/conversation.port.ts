/**
 * Conversation port — interface for storefront agent orchestration.
 *
 * Wraps LangGraph agent and returns structured message + blocks.
 */

import type { ConversationBlock } from "../types/conversation-block.js";

export interface StorefrontConversationInput {
  userMessage: string;
  cartId?: string;
  merchantId: string;
  sessionId: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  merchantName?: string;
}

export interface StorefrontConversationOutput {
  message: string;
  blocks: ConversationBlock[];
  cartId?: string;
  suggestedNext?: string[];
}

export const STOREFRONT_CONVERSATION_PORT = Symbol("StorefrontConversationPort");

export interface StorefrontConversationPort {
  reply(input: StorefrontConversationInput): Promise<StorefrontConversationOutput>;
}
