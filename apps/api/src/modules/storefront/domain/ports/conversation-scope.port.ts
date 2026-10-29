import type { StorefrontConversationDomain } from "../contracts/storefront-intent.schemas.js";

export const STOREFRONT_CONVERSATION_SCOPE = Symbol("StorefrontConversationScope");
/** Classification only. This port cannot grant a commercial action. */
export interface StorefrontConversationScopePort {
  classifyConversationScope(input: { userMessage: string; history: Array<{ role: "user" | "assistant"; content: string }> }): Promise<StorefrontConversationDomain>;
}
