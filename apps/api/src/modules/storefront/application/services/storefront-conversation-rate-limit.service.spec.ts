import test from "node:test";
import assert from "node:assert/strict";
import { DistributedRateLimitStore } from "../../../../shared/http/rate-limit.store.js";
import {
  STOREFRONT_CONVERSATION_REQUEST_LIMIT,
  STOREFRONT_CONVERSATION_RATE_WINDOW_MS,
  StorefrontConversationRateLimitService,
} from "./storefront-conversation-rate-limit.service.js";

test("allows exactly ten requests per minute for the verified AI user", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const store = new DistributedRateLimitStore({ production: false, ipMax: 600, tenantMax: 60, windowMs: 60_000 });
  t.after(() => store.onModuleDestroy());
  const limiter = new StorefrontConversationRateLimitService(store);

  for (let request = 1; request <= STOREFRONT_CONVERSATION_REQUEST_LIMIT; request++) {
    const decision = await limiter.consume("merchant_a", "conversation_a", "visitor:user_a");
    assert.equal(decision.allowed, true);
    assert.equal(decision.remaining, STOREFRONT_CONVERSATION_REQUEST_LIMIT - request);
  }

  const blocked = await limiter.consume("merchant_a", "conversation_a", "visitor:user_a");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs, STOREFRONT_CONVERSATION_RATE_WINDOW_MS);
});

test("conversation and merchant changes do not reset a user's budget; other users remain independent", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const store = new DistributedRateLimitStore({ production: false, ipMax: 600, tenantMax: 60, windowMs: 60_000 });
  t.after(() => store.onModuleDestroy());
  const limiter = new StorefrontConversationRateLimitService(store);

  for (let request = 0; request < STOREFRONT_CONVERSATION_REQUEST_LIMIT; request++) {
    await limiter.consume("merchant_a", "conversation_a", "visitor:user_a");
  }

  assert.equal((await limiter.consume("merchant_a", "conversation_b", "visitor:user_a")).allowed, false);
  assert.equal((await limiter.consume("merchant_b", "conversation_b", "visitor:user_a")).allowed, false);
  assert.equal((await limiter.consume("merchant_a", "conversation_a", "visitor:user_b")).allowed, true);
  t.mock.timers.tick(STOREFRONT_CONVERSATION_RATE_WINDOW_MS);
  const restored = await limiter.consume("merchant_a", "conversation_a", "visitor:user_a");
  assert.equal(restored.allowed, true); assert.equal(restored.remaining, 9);
});

test("missing user identity fails closed without consuming any quota", async () => {
  let hits = 0;
  const limiter = new StorefrontConversationRateLimitService({ hit: async () => { hits++; } } as never);
  await assert.rejects(limiter.consume("merchant_a", "conversation_a"), (error: { getStatus(): number; getResponse(): { code?: string } }) =>
    error.getStatus() === 503 && error.getResponse().code === "ai_user_identity_required");
  assert.equal(hits, 0);
});

test("unavailable authoritative quota store never admits a storefront message", async () => {
  const limiter = new StorefrontConversationRateLimitService({ hit: async () => { throw new Error("test_store_unavailable"); } } as never);
  await assert.rejects(limiter.consume("merchant_a", "conversation_a", "visitor:user_a"), (error: { getStatus(): number; getResponse(): { code?: string } }) =>
    error.getStatus() === 503 && error.getResponse().code === "ai_rate_limit_unavailable");
});
