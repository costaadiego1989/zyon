import type { AuthorizedOffer, MerchantRules } from "@aacp/shared-types";
import type { Objection } from "@aacp/conversation-engine";
import type { AgentContext } from "@aacp/shared-types";

export const CONVERSATION_PORT = Symbol("CONVERSATION_PORT");

export interface ConversationPort {
  reply(input: {
    userMessage: string;
    brandVoice: MerchantRules["brandVoice"];
    authorizedOffer?: AuthorizedOffer;
    agentContext?: AgentContext;
  }): Promise<{ message: string; objection: Objection }>;
}
