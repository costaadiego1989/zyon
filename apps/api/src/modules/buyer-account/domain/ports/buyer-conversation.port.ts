export type ConversationRole = "buyer" | "agent";
export type MessageRating = "up" | "down" | null;

export interface BuyerConversationMessage {
  id: string;
  role: ConversationRole;
  content: string;
  createdAt: Date;
  rating: MessageRating;
}

export interface BuyerConversation {
  id: string;
  globalUserId: string;
  sessionId: string;
  merchantId: string;
  startedAt: Date;
  lastMessageAt: Date;
  messages: BuyerConversationMessage[];
}

export const BUYER_CONVERSATION_REPOSITORY = Symbol("BUYER_CONVERSATION_REPOSITORY");

export interface BuyerConversationRepository {
  listByBuyer(globalUserId: string): Promise<BuyerConversation[]>;
  findById(globalUserId: string, id: string): Promise<BuyerConversation | null>;
  rateMessage(input: {
    conversationId: string;
    messageId: string;
    globalUserId: string;
    rating: "up" | "down";
  }): Promise<void>;
}
