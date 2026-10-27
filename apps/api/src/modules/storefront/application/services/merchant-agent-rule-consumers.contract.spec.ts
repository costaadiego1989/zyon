import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { SELF_DECLARED_DEPS_METADATA } from "@nestjs/common/constants.js";
import { MERCHANT_AGENT_RULE_READER, type MerchantAgentRuleReaderPort } from "../../../agent-rules/domain/ports/merchant-agent-rule-reader.port.js";
import { SendStoreMessageUseCase } from "../use-cases/send-store-message.use-case.js";
import { PrismaStorefrontConfigQueryRepository } from "../../infrastructure/repositories/prisma-storefront-config-query.repository.js";
import { StorefrontRealtimeVoiceController } from "../../presentation/http/storefront-realtime-voice.controller.js";

function readerFixture(value: unknown, fail = false) {
  const calls: string[] = [];
  const reader: MerchantAgentRuleReaderPort = { findForMerchant: async merchantId => { calls.push(merchantId); if (fail) throw value; return value as Awaited<ReturnType<MerchantAgentRuleReaderPort["findForMerchant"]>>; } };
  return { reader, calls };
}

for (const state of ["identity", "missing", "failure"] as const) {
  test(`send-message ${state} uses reader under resolved merchant and preserves optional identity handling`, async () => {
    const identity = { agentName: "Lia", greeting: "Olá", tone: "friendly", persona: "helpful", language: "pt-BR" };
    const r = readerFixture(state === "failure" ? new Error("synthetic-reader-error") : state === "missing" ? null : { identity, checkoutSettings: {} }, state === "failure");
    const generated: unknown[] = [];
    const merchant = { getProfile: async () => ({ name: "Store", storeCategory: "others" }), getStoreSettings: async () => ({}) };
    const conversation = { reply: async (context: unknown) => { generated.push(context); return { message: "Confira os produtos.", blocks: [], cartId: "session", suggestedNext: [] }; } };
    const prisma = { agentRule: { findFirst: async () => assert.fail("application must not query identity via Prisma") }, merchantRule: { findUnique: async () => null }, checkoutSetting: { findUnique: async () => null }, promptExperiment: { findFirst: async () => null }, buyerAccount: { findUnique: async () => null } };
    const useCase = new SendStoreMessageUseCase(merchant as never, conversation as never, prisma as never, r.reader);
    const output = await useCase.execute({ merchant_id: "merchant-a", conversation_id: "session", cart_id: "session", user_message: "Ver produtos" });
    assert.equal(output.message, "Confira os produtos.");
    assert.deepEqual(r.calls, ["merchant-a"]);
    assert.equal(generated.length, 1);
    assert.deepEqual((generated[0] as { agentIdentity?: unknown }).agentIdentity, state === "identity" ? identity : undefined);
  });
}

for (const state of ["identity", "missing", "failure"] as const) {
  test(`public config ${state} retains Promise.allSettled isolation and public projection`, async () => {
    const projected = { identity: { agentName: "Lia" }, checkoutSettings: { agentMode: "proactive" } };
    const r = readerFixture(state === "failure" ? new Error("synthetic-reader-error") : state === "missing" ? null : projected, state === "failure");
    const prisma = { merchant: { findUnique: async () => ({ id: "merchant-a", name: "Store", storeSettings: {}, theme: {} }) }, agentRule: { findFirst: async () => assert.fail("storefront repository must use reader") }, merchantBillingSubscription: { findUnique: async () => null }, merchantRule: { findUnique: async () => ({ quickReplies: { welcome: ["Ver produtos"] } }) }, checkoutSetting: { findUnique: async () => ({ mode: "manual_only" }) }, storyCategory: { findMany: async () => [{ id: "story-a" }] }, merchantPolicy: { findUnique: async () => null } };
    const repository = new PrismaStorefrontConfigQueryRepository(prisma as never, r.reader);
    const result = await repository.findMerchantConfig("merchant-a");
    assert.deepEqual(r.calls, ["merchant-a"]);
    assert.equal(result?.merchant.id, "merchant-a");
    assert.deepEqual(result?.agentRule, state === "identity" ? projected : undefined);
    assert.deepEqual(result?.stories, [{ id: "story-a" }]);
    assert.equal(result?.checkoutMode, "manual_only");
    assert.equal(result?.policiesAvailable, true);
  });
}

for (const state of ["identity", "missing", "failure"] as const) {
  test(`realtime ${state} keeps verified tenant, billing order and standard greeting fallback`, async () => {
    const sequence: string[] = [];
    const identity = { agentName: "Lia", greeting: "Olá", tone: "internal-not-forwarded" };
    const r = readerFixture(state === "failure" ? new Error("synthetic-reader-error") : state === "missing" ? null : { identity, checkoutSettings: {} }, state === "failure");
    const reader = { findForMerchant: async (merchantId: string) => { sequence.push("identity"); return r.reader.findForMerchant(merchantId); } };
    let generated: unknown;
    const controller = new StorefrontRealtimeVoiceController(
      { verify: () => { sequence.push("verify"); return { merchantId: "merchant-a", resourceId: "session", aiUserId: "buyer-a" }; } } as never,
      { getOrCreate: async (merchantId: string, sessionId: string) => { sequence.push("cart"); assert.deepEqual([merchantId, sessionId], ["merchant-a", "session"]); return { items: [], total: 1000, discount: 0 }; } } as never,
      reader,
      { assertAllowed: async (...args: unknown[]) => { sequence.push("billing"); assert.deepEqual(args, ["merchant-a", { kind: "feature", key: "voiceCheckout" }]); } } as never,
      { createCall: async (context: unknown) => { sequence.push("realtime"); generated = context; return { sdp: "answer" }; } } as never,
      { classifyConversationScope: async () => "STORE_COMMERCE" },
    );
    assert.deepEqual(await controller.createSession({ headers: { authorization: "Bearer synthetic" } }, "session", { sdp: "v=0\r\n" }), { sdp: "answer" });
    assert.deepEqual(sequence, ["verify", "billing", "cart", "identity", "realtime"]);
    assert.deepEqual(r.calls, ["merchant-a"]);
    assert.ok(generated && typeof generated === "object" && "checkScope" in generated);
    const { checkScope, ...context } = generated;
    assert.ok(typeof checkScope === "function");
    assert.deepEqual(context, { surface: "storefront", sdp: "v=0", aiUserId: "buyer-a", origin: undefined, merchantId: "merchant-a", conversationId: "session", ...(state === "identity" ? { agentName: "Lia", greeting: "Olá" } : {}), cart: { items: [], total: 10, currency: "BRL" } });
    assert.deepEqual(await checkScope({ userMessage: "Buscar produtos", history: [] }), { allowed: true });
  });
}

test("three consumers require the domain reader token at explicit constructor positions", () => {
  for (const [consumer, index] of [[SendStoreMessageUseCase, 3], [PrismaStorefrontConfigQueryRepository, 1], [StorefrontRealtimeVoiceController, 2]] as const) {
    const declared = Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, consumer) as Array<{ index: number; param: unknown }>;
    assert.equal(declared.find(value => value.index === index)?.param, MERCHANT_AGENT_RULE_READER);
  }
});

for (const deniedAt of ["capability", "billing"] as const) {
  test(`realtime ${deniedAt} rejection happens before identity, cart and provider IO`, async () => {
    const calls: string[] = [];
    const failure = new Error("synthetic-admission-error");
    const controller = new StorefrontRealtimeVoiceController(
      { verify: () => { calls.push("verify"); if (deniedAt === "capability") throw failure; return { merchantId: "merchant-a", resourceId: "session", aiUserId: "buyer-a" }; } } as never,
      { getOrCreate: async () => assert.fail("denied session cannot load a cart") } as never,
      { findForMerchant: async () => assert.fail("denied session cannot load agent identity") },
      { assertAllowed: async () => { calls.push("billing"); throw failure; } } as never,
      { createCall: async () => assert.fail("denied session cannot reach realtime provider") } as never,
      { classifyConversationScope: async () => assert.fail("denied session cannot classify a turn") },
    );
    await assert.rejects(controller.createSession({ headers: { authorization: "Bearer synthetic" } }, "session", { sdp: "v=0\r\n" }), error => deniedAt === "billing" ? error === failure : error instanceof Error && error.message === "invalid_conversation_token");
    assert.deepEqual(calls, deniedAt === "capability" ? ["verify"] : ["verify", "billing"]);
  });
}

