import { Inject, Injectable } from "@nestjs/common";
import { RateLimitStore, type RateLimitDecision } from "../../../../shared/rate-limit/rate-limit.store.js";

/**
 * A buyer may make at most ten requests in a minute in the same storefront
 * conversation. The key is based on verified capability claims, so reconnecting
 * or switching between HTTP and WebSocket cannot reset the allowance.
 */
export const STOREFRONT_CONVERSATION_REQUEST_LIMIT = 10;
export const STOREFRONT_CONVERSATION_RATE_WINDOW_MS = 60_000;

@Injectable()
export class StorefrontConversationRateLimitService {
  constructor(@Inject(RateLimitStore) private readonly store: RateLimitStore) {}

  consume(merchantId: string, conversationId: string, now = Date.now()): RateLimitDecision {
    return this.store.hit(
      `storefront:conversation:${merchantId}:${conversationId}`,
      STOREFRONT_CONVERSATION_REQUEST_LIMIT,
      STOREFRONT_CONVERSATION_RATE_WINDOW_MS,
      now,
    );
  }
}
