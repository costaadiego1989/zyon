import test from "node:test";
import assert from "node:assert/strict";
import { DistributedRateLimitStore } from "../../../../shared/http/rate-limit.store.js";
import {
  STOREFRONT_CONVERSATION_REQUEST_LIMIT,
  STOREFRONT_CONVERSATION_RATE_WINDOW_MS,
  StorefrontConversationRateLimitService,
} from "./storefront-conversation-rate-limit.service.js";

function store() {
  return new DistributedRateLimitStore({ production: false, ipMax: 600, tenantMax: 60, windowMs: 60000 });
}

test("allows exactly ten requests per minute for each verified user", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const limiter = new StorefrontConversationRateLimitService(store());

  for (let request = 1; request <= STOREFRONT_CONVERSATION_REQUEST_LIMIT; request++) {
    const decision = await limiter.consume("merchant_a", "conversation_a", "buyer:user_a");
    assert.equal(decision.allowed, true);
    assert.equal(decision.remaining, STOREFRONT_CONVERSATION_REQUEST_LIMIT - request);
  }

  const blocked = await limiter.consume("merchant_a", "conversation_a", "buyer:user_a");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs, STOREFRONT_CONVERSATION_RATE_WINDOW_MS);
});

test("isolates users and restores allowance after one minute", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const limiter = new StorefrontConversationRateLimitService(store());

  for (let request = 0; request < STOREFRONT_CONVERSATION_REQUEST_LIMIT; request++) {
    await limiter.consume("merchant_a", "conversation_a", "buyer:user_a");
  }

  assert.equal((await limiter.consume("merchant_a", "conversation_b", "buyer:user_b")).allowed, true);
  assert.equal((await limiter.consume("merchant_b", "conversation_a", "buyer:user_b")).allowed, true);
  t.mock.timers.tick(STOREFRONT_CONVERSATION_RATE_WINDOW_MS);
  assert.equal((await limiter.consume("merchant_a", "conversation_a", "buyer:user_a")).allowed, true);
});

test("does not grant a local allowance when the shared counter fails", async () => {
  const limiter = new StorefrontConversationRateLimitService({ hit: async () => { throw new Error("offline"); } } as never);
  await assert.rejects(limiter.consume("merchant_a", "conversation_a", "buyer:user_a"),
    (error: any) => error.getStatus() === 503 && error.getResponse().code === "ai_rate_limit_unavailable");
});
