import assert from "node:assert/strict";
import test from "node:test";
import { SupportController } from "./support.controller.js";
import { AiUserRateLimitService } from "../../../../shared/http/ai-user-rate-limit.service.js";
import { AiUserIdentityService } from "../../../../shared/http/ai-user-identity.service.js";
import { DistributedRateLimitStore } from "../../../../shared/http/rate-limit.store.js";

test("support shares the buyer allowance with commerce and ignores unsigned buyer selectors", async () => {
  const limiter = new AiUserRateLimitService(new DistributedRateLimitStore({ production: false, ipMax: 600, tenantMax: 60, windowMs: 60_000 }));
  const identities = new AiUserIdentityService("test-support-ai-secret-at-least-32-characters");
  const visitor = identities.resolve({ merchantId: "m_a" });
  const contexts: any[] = [];
  const controller = new SupportController(
    { execute: async (_input: unknown, context: unknown) => { contexts.push(context); return { reply: "Resposta oficial" }; } } as never,
    { execute: async () => ({ faqItems: [] }) } as never,
    {} as never, {} as never, {} as never, {} as never, {} as never,
    limiter, identities,
  );
  for (let i = 0; i < 5; i++) await limiter.assertAllowed(visitor.userId);
  const request = { headers: { "x-ai-user-token": visitor.token } };
  const body = { merchant_id: "m_a", message: "Pergunta", buyer_global_user_id: "victim" };
  for (let i = 0; i < 5; i++) await controller.chatPublic(body, request);
  await assert.rejects(() => controller.chatPublic(body, request), (error: any) => error.getStatus() === 429);
  assert.equal(contexts.length, 5);
  assert.ok(contexts.every(context => context.buyerGlobalUserId === undefined));
  const other = identities.resolve({ merchantId: "m_a" });
  await controller.chatPublic(body, { headers: { "x-ai-user-token": other.token } });
  assert.equal(contexts.length, 6);
});
