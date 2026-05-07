import type { AgentContext, AuthorizedOffer, Cart, ChatStage, ChatTurn, MerchantRules } from "@aacp/shared-types";
import type { Objection } from "@aacp/conversation-engine";

export const CONVERSATION_PORT = Symbol("CONVERSATION_PORT");

export interface ConversationReplyInput {
  userMessage: string;
  brandVoice: MerchantRules["brandVoice"];
  authorizedOffer?: AuthorizedOffer;
  agentContext?: AgentContext;
  merchantName?: string;
  cart?: Cart;
  history?: ChatTurn[];
  stage?: ChatStage;
  missingFields?: string[];
  deliverySummary?: string;
}

export interface ConversationPort {
  reply(input: ConversationReplyInput): Promise<{ message: string; objection: Objection }>;
}
