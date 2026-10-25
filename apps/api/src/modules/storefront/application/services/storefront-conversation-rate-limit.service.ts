import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { DistributedRateLimitStore, type QuotaDecision } from "../../../../shared/http/rate-limit.store.js";
import { AiUserRateLimitService } from "../../../../shared/http/ai-user-rate-limit.service.js";

/**
 * Adapts storefront entry points to the shared user policy. Conversation,
 * merchant, channel and plan changes never allocate an additional allowance.
 */
export const STOREFRONT_CONVERSATION_REQUEST_LIMIT = 10;
export const STOREFRONT_CONVERSATION_RATE_WINDOW_MS = 60_000;

@Injectable()
export class StorefrontConversationRateLimitService {
  constructor(@Inject(DistributedRateLimitStore) private readonly store: DistributedRateLimitStore) {}

  async consume(merchantId: string, conversationId: string, userId?: string): Promise<QuotaDecision & { limit: number }> {
    if (userId) return new AiUserRateLimitService(this.store).consume(userId);
    throw new ServiceUnavailableException({ code: "ai_user_identity_required" });
  }
}
