import test from "node:test";
import assert from "node:assert/strict";
import { AiUserRateLimitService } from "./ai-user-rate-limit.service.js";
import { DistributedRateLimitStore } from "./rate-limit.store.js";
import { AiUserIdentityService } from "./ai-user-identity.service.js";
import { RealtimeCapabilityService } from "../auth/realtime-capability.js";
import { toProblemDetails } from "./problem-details.filter.js";
import { StorefrontConversationRateLimitService } from "../../modules/storefront/application/services/storefront-conversation-rate-limit.service.js";
import { ConversationRateLimitService } from "../../modules/checkout/application/services/conversation-rate-limit.service.js";

const secret = "test-ai-user-secret-with-at-least-32-characters";
function store() { return new DistributedRateLimitStore({ production: false, ipMax: 600, tenantMax: 60, windowMs: 60000 }); }

test("ten messages per user shared across storefront/checkout/conversations; other users and global buckets stay independent", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const counters = store();
  const storefront = new StorefrontConversationRateLimitService(counters);
  const checkout = new ConversationRateLimitService({ getEffectivePlan: async () => "scale" } as never, counters);
  for (let i = 0; i < 5; i++) assert.equal((await storefront.consume("m_a", `conv_${i}`, "buyer:user_a")).allowed, true);
  for (let i = 0; i < 5; i++) await checkout.assertAllowed({ merchantId: "m_b", sessionId: `session_${i}`, userId: "buyer:user_a" });
  await assert.rejects(() => checkout.assertAllowed({ merchantId: "m_c", sessionId: "new_session", userId: "buyer:user_a" }), (error: any) => {
    const problem = toProblemDetails(error, "corr_test");
    assert.equal(problem.code, "ai_interaction_rate_limited");
    assert.equal(problem.retry_after_seconds, 60);
    return problem.status === 429;
  });
  assert.equal((await storefront.consume("m_a", "same_conversation", "buyer:user_b")).allowed, true);
  const global = await counters.hit("ip:shared-kong-proxy", 600, 60000);
  assert.equal(global.remaining, 599);
  t.mock.timers.tick(60000);
  assert.equal((await storefront.consume("m_a", "new_conv", "buyer:user_a")).allowed, true);
});

test("overlapping requests on one user admit exactly ten", async () => {
  const limiter = new AiUserRateLimitService(store());
  const results = await Promise.all(Array.from({ length: 25 }, () => limiter.consume("buyer:user_a")));
  assert.equal(results.filter(result => result.allowed).length, 10);
});

test("visitor identity persists and cannot be supplied as an unsigned ID", () => {
  const identities = new AiUserIdentityService(secret);
  const first = identities.resolve({ merchantId: "m_a" });
  assert.equal(identities.resolve({ merchantId: "m_b", visitorToken: first.token }).userId, first.userId);
  assert.throws(() => identities.resolve({ merchantId: "m_a", visitorToken: "visitor:attacker" }));
  const capability = new RealtimeCapabilityService(secret);
  const token = capability.issue({ purpose: "storefront-conversation", merchantId: "m_a", resourceId: "conv_a", aiUserId: first.userId }).token;
  const renewed = capability.renewConversation(token, "conv_a");
  assert.equal(capability.verify(renewed.token, "storefront-conversation").aiUserId, first.userId);
});

test("voice turn authorization is bound to user/resource and can be consumed only once", async () => {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = secret;
  try {
    const limiter = new AiUserRateLimitService(store());
    const authority = { userId: "buyer:user_a", merchantId: "m_a", resourceId: "conv_a" };
    const token = new RealtimeCapabilityService(secret).issue({ purpose: "ai-voice-turn", merchantId: authority.merchantId, resourceId: authority.resourceId, aiUserId: authority.userId }).token;
    assert.ok(token.length < 512);
    await assert.rejects(() => limiter.consumeVoicePermit(token, { ...authority, userId: "buyer:user_b" }));
    await assert.rejects(() => limiter.consumeVoicePermit(token, { ...authority, resourceId: "conv_b" }));
    assert.equal(await limiter.consumeVoicePermit(token, authority), true);
    await assert.rejects(() => limiter.consumeVoicePermit(token, authority), /voice_turn_already_consumed/);
  } finally { if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous; }
});

test("counter outages fail closed", async () => {
  const limiter = new AiUserRateLimitService({ hit: async () => { throw new Error("redis_offline"); } } as never);
  await assert.rejects(() => limiter.assertAllowed("buyer:user_a"), (error: any) => error.getStatus() === 503 && error.getResponse().code === "ai_rate_limit_unavailable");
});

test("automatic suggestions are bounded separately and preserve all ten user messages", async () => {
  const limiter = new AiUserRateLimitService(store());
  await limiter.assertNudgeAllowed("buyer:user_a");
  await limiter.assertNudgeAllowed("buyer:user_a");
  await assert.rejects(() => limiter.assertNudgeAllowed("buyer:user_a"), (error: any) => error.getStatus() === 429);
  for (let i = 0; i < 10; i++) await limiter.assertAllowed("buyer:user_a");
  await assert.rejects(() => limiter.assertAllowed("buyer:user_a"), (error: any) => error.getStatus() === 429);
});
