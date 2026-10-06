import assert from "node:assert/strict";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import { ConversationRateLimitService } from "./conversation-rate-limit.service.js";

class MemoryRateLimitStore {
  private readonly counts = new Map<string, number>();

  async hit(key: string, limit: number, windowMs: number) {
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetAt: Date.now() + windowMs,
      retryAfterMs: windowMs,
    };
  }
}

function service(plan: "starter" | "growth" | "scale", store = new MemoryRateLimitStore()) {
  return new ConversationRateLimitService(
    { getEffectivePlan: async () => plan } as any,
    store as any,
  );
}

async function assertConversationIsLimited(
  plan: "starter" | "growth" | "scale",
  messagesPerMinute: number,
): Promise<void> {
  const limiter = service(plan);
  for (let index = 0; index < messagesPerMinute; index++) {
    await limiter.assertAllowed({ merchantId: "merchant_1", sessionId: "session_1", userId: "buyer:user_1" });
  }

  await assert.rejects(
    () => limiter.assertAllowed({ merchantId: "merchant_1", sessionId: "session_1", userId: "buyer:user_1" }),
    (error: unknown) => error instanceof HttpException
      && error.getStatus() === 429
      && (error.getResponse() as { code: string }).code === "ai_interaction_rate_limited"
      && (error.getResponse() as { scope: string }).scope === "user"
      && !("plan" in (error.getResponse() as object))
      && !("limit" in (error.getResponse() as object)),
  );
}

test("Starter limits a user to ten messages per minute", async () => {
  await assertConversationIsLimited("starter", 10);
});

test("Growth and Scale limit a user to ten messages per minute", async () => {
  await assertConversationIsLimited("growth", 10);
  await assertConversationIsLimited("scale", 10);
});

test("A busy user never consumes another user's allowance", async () => {
  const limiter = service("scale");
  for (let index = 0; index < 10; index++) {
    await limiter.assertAllowed({ merchantId: "merchant_1", sessionId: "session_1", userId: "buyer:user_1" });
  }

  await limiter.assertAllowed({ merchantId: "merchant_1", sessionId: "session_2", userId: "buyer:user_2" });
});
