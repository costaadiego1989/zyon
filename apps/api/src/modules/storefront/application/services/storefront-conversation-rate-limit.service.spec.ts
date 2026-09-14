import test from "node:test";
import assert from "node:assert/strict";
import { RateLimitStore } from "../../../../shared/rate-limit/rate-limit.store.js";
import {
  STOREFRONT_CONVERSATION_REQUEST_LIMIT,
  STOREFRONT_CONVERSATION_RATE_WINDOW_MS,
  StorefrontConversationRateLimitService,
} from "./storefront-conversation-rate-limit.service.js";

test("allows exactly ten requests per minute for each verified storefront conversation", () => {
  const limiter = new StorefrontConversationRateLimitService(new RateLimitStore());
  const now = 1_000_000;

  for (let request = 1; request <= STOREFRONT_CONVERSATION_REQUEST_LIMIT; request++) {
    const decision = limiter.consume("merchant_a", "conversation_a", now);
    assert.equal(decision.allowed, true);
    assert.equal(decision.remaining, STOREFRONT_CONVERSATION_REQUEST_LIMIT - request);
  }

  const blocked = limiter.consume("merchant_a", "conversation_a", now);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs, STOREFRONT_CONVERSATION_RATE_WINDOW_MS);
});

test("does not share a budget across storefront conversations and restores it after one minute", () => {
  const limiter = new StorefrontConversationRateLimitService(new RateLimitStore());
  const now = 1_000_000;

  for (let request = 0; request < STOREFRONT_CONVERSATION_REQUEST_LIMIT; request++) {
    limiter.consume("merchant_a", "conversation_a", now);
  }

  assert.equal(limiter.consume("merchant_a", "conversation_b", now).allowed, true);
  assert.equal(
    limiter.consume("merchant_a", "conversation_a", now + STOREFRONT_CONVERSATION_RATE_WINDOW_MS).allowed,
    true,
  );
});
