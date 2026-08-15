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
  listByBuyer(globalUserId: string, options?: { maxAgeDays?: number }): Promise<BuyerConversation[]>;
  listByBuyerSince(globalUserId: string, since: Date): Promise<BuyerConversation[]>;
  findById(globalUserId: string, id: string): Promise<BuyerConversation | null>;
  findBySession(merchantId: string, sessionId: string): Promise<BuyerConversation | null>;
  upsertConversation(input: {
    globalUserId: string;
    sessionId: string;
    merchantId: string;
    message: BuyerConversationMessage;
  }): Promise<void>;
  upsertFromCheckout(input: {
    merchantId: string;
    sessionId: string;
    globalUserId: string;
    messages: BuyerConversationMessage[];
  }): Promise<void>;
  rateMessage(input: {
    conversationId: string;
    messageId: string;
    globalUserId: string;
    rating: "up" | "down";
  }): Promise<void>;
}
