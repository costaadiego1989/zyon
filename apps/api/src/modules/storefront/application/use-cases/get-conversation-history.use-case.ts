import { Injectable, Inject, Optional } from "@nestjs/common";
import { MARKETING_RELATIONSHIP, type MarketingRelationshipPort } from "../../../../shared/contracts/marketing.js";
import { STOREFRONT_CONVERSATION_PORT, type StorefrontConversationPort } from "../../domain/ports/conversation.port.js";
export interface GetConversationHistoryInput { merchant_id: string; conversation_id: string }
export interface GetConversationHistoryOutput {
  conversation_id: string; handoff?: boolean; format?: "messages-v1";
  messages: Array<{id: string; role: "user" | "assistant"; content: string; timestamp: string; sequence: number; client_id?: string}>;
}
@Injectable()
export class GetConversationHistoryUseCase {
  constructor(@Inject(STOREFRONT_CONVERSATION_PORT) private readonly conversation: StorefrontConversationPort,
    @Optional() @Inject(MARKETING_RELATIONSHIP) private readonly marketing?: MarketingRelationshipPort) {}
  async execute(input: GetConversationHistoryInput): Promise<GetConversationHistoryOutput> {
    if (!this.marketing || !await this.marketing.enabled(input.merchant_id)) return {conversation_id: input.conversation_id, messages: []};
    const projected = await this.marketing.history(input.merchant_id, "site", input.conversation_id);
    const state = await this.marketing.conversationState(input.merchant_id, "site", input.conversation_id);
    const messages = (projected ?? []).filter(m => m.role !== "system" && ["recorded", "accepted", "delivered", "read"].includes(m.status)).slice(-200)
      .map((m,i) => ({id:m.id, role:m.role === "buyer" ? "user" as const : "assistant" as const, content:m.content,
        timestamp:m.createdAt, sequence:i+1, ...(m.requestId ? {client_id:m.requestId} : {})}));
    return {conversation_id:input.conversation_id, format:"messages-v1", handoff:state?.mode === "human", messages};
  }
}
