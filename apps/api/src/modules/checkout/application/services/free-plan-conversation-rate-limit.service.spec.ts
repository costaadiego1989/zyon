import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { HttpException } from "@nestjs/common";
import { DistributedRateLimitStore } from "../../../../shared/http/rate-limit.store.js";
import { AiUserRateLimitService } from "../../../../shared/http/ai-user-rate-limit.service.js";
import { StorefrontConversationRateLimitService } from "../../../storefront/application/services/storefront-conversation-rate-limit.service.js";
import { ConversationRateLimitService } from "./conversation-rate-limit.service.js";

function storeFor(t: TestContext) {
  const store = new DistributedRateLimitStore({ production: false, ipMax: 600, tenantMax: 60, windowMs: 60_000 });
  t.after(() => store.onModuleDestroy());
  return store;
}

function service(plan: "starter" | "growth" | "scale", store: DistributedRateLimitStore) {
  return new ConversationRateLimitService(
    { getEffectivePlan: async () => { assert.fail(`Per-user message admission must not query the ${plan} plan`); } } as never,
    store,
  );
}

const message = { merchantId: "merchant_1", sessionId: "session_1", userId: "visitor:user_1" };
const responseError = (status: number, code: string) => (error: unknown) =>
  error instanceof HttpException && error.getStatus() === status && (error.getResponse() as { code?: string }).code === code;

function limitedUser(error: unknown): boolean {
  if (!(error instanceof HttpException) || error.getStatus() !== 429) return false;
  const body = error.getResponse() as Record<string, unknown>;
  assert.equal(body.code, "ai_interaction_rate_limited");
  assert.equal(body.scope, "user");
  assert.equal(body.retry_after_seconds, 60);
  assert.equal("plan" in body, false);
  assert.equal("limit" in body, false);
  assert.equal(JSON.stringify(body).includes(message.userId), false);
  return true;
}

async function assertUserIsLimited(t: TestContext, plan: "starter" | "growth" | "scale") {
  const limiter = service(plan, storeFor(t));
  for (let index = 0; index < 10; index++) await limiter.assertAllowed(message);
  await assert.rejects(() => limiter.assertAllowed(message), limitedUser);
}

test("Starter admits exactly ten messages per verified AI user per minute", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  await assertUserIsLimited(t, "starter");
});

test("Growth and Scale keep the same per-user safety quota, independently of monthly plan metering", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  await assertUserIsLimited(t, "growth");
  await assertUserIsLimited(t, "scale");
});

test("changing session or merchant does not reset a user's budget; another user has an independent bucket", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const limiter = service("scale", storeFor(t));
  for (let index = 0; index < 10; index++) await limiter.assertAllowed(message);
  await assert.rejects(() => limiter.assertAllowed({ ...message, sessionId: "session_2" }), limitedUser);
  await assert.rejects(() => limiter.assertAllowed({ ...message, merchantId: "merchant_2" }), limitedUser);
  await limiter.assertAllowed({ ...message, userId: "visitor:user_2" });
});

test("checkout missing a verified user fails closed before consuming any quota", async () => {
  let hits = 0;
  const limiter = service("starter", { hit: async () => { hits++; assert.fail("Missing user must not consume quota"); } } as never);
  await assert.rejects(() => limiter.assertAllowed({ merchantId: message.merchantId, sessionId: message.sessionId }),
    responseError(503, "ai_user_identity_required"));
  assert.equal(hits, 0);
});

test("oversized user identity is rejected before consuming any quota", async () => {
  let hits = 0;
  const limiter = service("starter", { hit: async () => { hits++; assert.fail("Invalid user must not consume quota"); } } as never);
  await assert.rejects(() => limiter.assertAllowed({ ...message, userId: "x".repeat(251) }),
    (error: unknown) => error instanceof HttpException && error.getStatus() === 401 && error.message === "ai_user_identity_required");
  assert.equal(hits, 0);
});

test("unavailable authoritative quota store rejects checkout without retry or local admission", async () => {
  let hits = 0;
  const limiter = service("growth", { hit: async () => { hits++; throw new Error("synthetic_store_unavailable"); } } as never);
  await assert.rejects(() => limiter.assertAllowed(message), responseError(503, "ai_rate_limit_unavailable"));
  assert.equal(hits, 1);
});

test("user quota restores only after the complete sixty-second window", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const limiter = service("starter", storeFor(t));
  for (let index = 0; index < 10; index++) await limiter.assertAllowed(message);
  t.mock.timers.tick(59_999);
  await assert.rejects(() => limiter.assertAllowed(message), responseError(429, "ai_interaction_rate_limited"));
  t.mock.timers.tick(1);
  for (let index = 0; index < 10; index++) await limiter.assertAllowed(message);
  await assert.rejects(() => limiter.assertAllowed(message), limitedUser);
});

test("checkout, storefront and the common voice admission service share one user budget", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const store = storeFor(t);
  const checkout = service("scale", store);
  const storefront = new StorefrontConversationRateLimitService(store);
  const voiceAdmission = new AiUserRateLimitService(store);
  for (let index = 0; index < 9; index++) await checkout.assertAllowed(message);
  const tenth = await storefront.consume(message.merchantId, "conversation_1", message.userId);
  assert.equal(tenth.allowed, true);
  assert.equal(tenth.remaining, 0);
  await assert.rejects(() => voiceAdmission.assertAllowed(message.userId), limitedUser);
  await assert.rejects(() => checkout.assertAllowed({ ...message, sessionId: "session_2" }), limitedUser);
  await voiceAdmission.assertAllowed("visitor:user_2");
});
