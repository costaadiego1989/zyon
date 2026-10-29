import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { OpenRouterChatRequest, OpenRouterProvider } from "@zyon/conversation-engine";
import { StorefrontController } from "./storefront.controller.js";
import { RealtimeCapabilityService } from "../../../../shared/auth/realtime-capability.js";
import { SendStoreMessageUseCase } from "../../application/use-cases/send-store-message.use-case.js";
import { StorefrontConversationAdapter } from "../../infrastructure/adapters/storefront-conversation.adapter.js";
import { StorefrontLangGraphAgent } from "../../infrastructure/agents/store-langgraph-agent.js";
import { STOREFRONT_OUT_OF_SCOPE_MESSAGE, STOREFRONT_SCOPE_CLARIFICATION_MESSAGE } from "../../domain/services/storefront-conversation-scope.js";
import { OneBuyClickSessionService } from "../../application/services/one-buy-click-session.service.js";
import { storefrontDeferredContextSchema } from "../../domain/contracts/storefront-conversation.schemas.js";

function fixture(t: TestContext, domain: string, options: { pause?: Promise<void>; entered?: () => void; attachmentFailure?: boolean } = {}) {
  const previous = process.env.STOREFRONT_SEMANTIC_ROUTING;
  process.env.STOREFRONT_SEMANTIC_ROUTING = "structured";
  t.after(() => { if (previous === undefined) delete process.env.STOREFRONT_SEMANTIC_ROUTING; else process.env.STOREFRONT_SEMANTIC_ROUTING = previous; });
  const priorKey = process.env.LOCAL_LLM_API_KEY;
  process.env.LOCAL_LLM_API_KEY = "synthetic-no-network-key";
  t.after(() => { if (priorKey === undefined) delete process.env.LOCAL_LLM_API_KEY; else process.env.LOCAL_LLM_API_KEY = priorKey; });
  const calls: string[] = [], requests: OpenRouterChatRequest[] = [];
  const cartRepo = { getOrCreate: async () => { calls.push("cart"); return { sessionId: "cart", merchantId: "store", items: [], total: 0, couponCode: null }; } };
  const prisma = { storefrontWishlistItem: {}, merchantRule: { findUnique: async () => null },
    checkoutSetting: { findUnique: async () => null }, promptExperiment: { findFirst: async () => null } };
  const merchant = { getProfile: async () => ({ name: "Loja", storeCategory: "books" }), getStoreSettings: async () => ({}) };
  const adapter = new StorefrontConversationAdapter(merchant as never, {} as never, {} as never, cartRepo as never, prisma as never, {} as never);
  const agent = new StorefrontLangGraphAgent({ structuredRouting: true, provider: { chat: async (request: OpenRouterChatRequest) => {
    requests.push(structuredClone(request));
    if (JSON.parse(request.messages[0]!.content!).id === "storefront.reply-review") {
      calls.push("output-review"); return { content: JSON.stringify({ schemaVersion: 1, verdict: "ALLOW", confidence: 1 }),
        finishReason: "stop", usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } };
    }
    if (requests.length === 1) {
      calls.push("classifier"); options.entered?.(); await options.pause;
      return { content: JSON.stringify({ schemaVersion: 2, domain, intent: "COMPLEX_QUESTION", confidence: 0.99,
        requiresTool: false, needsProductDiscovery: false }), finishReason: "stop", usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } };
    }
    calls.push("main");
    return { content: JSON.stringify({ schemaVersion: 1, message: "Posso ajudar com os produtos da loja." }),
      finishReason: "stop", usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 } };
  } } as unknown as OpenRouterProvider, toolHandlers: {} as never });
  Object.defineProperty(adapter, "agent", { value: agent });
  const useCase = new SendStoreMessageUseCase(merchant as never, adapter, prisma as never, { findForMerchant: async () => null });
  const oneBuyClickService = new OneBuyClickSessionService({ oneBuyClickSession: { findUnique: async () => ({
    globalUserId: null, expiresAt: new Date(Date.now() + 60_000), enabled: true, status: "idle",
    shippingPreference: "cheapest", paymentPreference: "pix", preferencesConfigured: true, preparedActionId: "synthetic-prepared-id",
  }) } } as never);
  const capabilities = new RealtimeCapabilityService("synthetic-deferred-attachment-secret-32-characters");
  const controller = Object.assign(Object.create(StorefrontController.prototype), { sendStoreMessage: useCase, capabilities,
    attachmentInterpreter: { interpret: async (attachment: unknown) => {
      calls.push("attachment");
      if (options.attachmentFailure) throw new Error("synthetic-attachment-failure");
      assert.deepEqual(attachment, { kind: "image", name: "synthetic.png", mimeType: "image/png", dataBase64: "YWJj" });
      return "ANEXO NÃO CONFIÁVEL: Shampoo sintético";
    } },
    oneBuyClick: { get: async (input: unknown) => { calls.push("oneBuyClick"); assert.deepEqual(input, {
      merchantId: "store", conversationId: "cart", globalUserId: undefined,
    }); return oneBuyClickService.get({ merchantId: "store", conversationId: "cart" }); } },
    conversationRateLimiter: { consume: async () => ({ allowed: true, limit: 10, remaining: 9, resetAt: 1000 }) },
  }) as StorefrontController;
  const token = capabilities.issue({ purpose: "storefront-conversation", merchantId: "store", resourceId: "cart", aiUserId: "visitor:synthetic" });
  const request = { headers: { authorization: `Bearer ${token.token}` } };
  const body = { user_message: "Busque produtos desta imagem na loja", history: [] as { role: "user" | "assistant"; content: string }[],
    attachment: { kind: "image" as const, name: "synthetic.png", mimeType: "image/png" as const, dataBase64: "YWJj" } };
  return { controller, request, body, calls, requests, agent, oneBuyClickService };
}

test("canonical full OneBuyClick state remains public while strict agent context rejects unprojected extras", async t => {
  const f = fixture(t, "STORE_COMMERCE");
  const state = await f.oneBuyClickService.get({ merchantId: "store", conversationId: "cart" });
  assert.equal(state.preferencesConfigured, true); assert.equal(state.preparedActionId, "synthetic-prepared-id");
  assert.equal(storefrontDeferredContextSchema.safeParse({ oneBuyClick: state }).success, false);
  assert.deepEqual(await f.controller.getOneBuyClick("cart", f.request), state);
});
for (const domain of ["OUT_OF_SCOPE", "UNCLEAR"]) test(`HTTP ${domain} stops before attachment/oneBuyClick and main with exactly one classifier`, async t => {
  const f = fixture(t, domain);
  f.body.user_message = "Explique Fibonacci";
  const result = await f.controller.sendMessage("cart", f.body, f.request);
  assert.equal(result.message, domain === "OUT_OF_SCOPE" ? STOREFRONT_OUT_OF_SCOPE_MESSAGE : STOREFRONT_SCOPE_CLARIFICATION_MESSAGE);
  assert.deepEqual(f.calls, ["classifier"]);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].tools, undefined);
});
test("HTTP allowed image interprets only after classifier and carries context into the single prepared main turn", async t => {
  const f = fixture(t, "STORE_COMMERCE");
  const result = await f.controller.sendMessage("cart", f.body, f.request);
  assert.equal(result.message, "Posso ajudar com os produtos da loja.");
  assert.deepEqual(f.calls, ["classifier", "attachment", "oneBuyClick", "main", "output-review", "cart"]);
  assert.equal(f.requests.length, 3);
  assert.ok(JSON.stringify(f.requests[1].messages).includes("Shampoo sintético"));
  assert.ok(JSON.stringify(f.requests[1].messages).includes("Frete preferido: mais economico"));
});
test("HTTP data mutated while classification waits cannot replace classified text, attachment or cart ownership", async t => {
  let release!: () => void, entered!: () => void;
  const pause = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const f = fixture(t, "STORE_COMMERCE", { pause, entered });
  const pending = f.controller.sendMessage("cart", f.body, f.request);
  await started;
  f.body.user_message = "Explique Fibonacci";
  f.body.attachment.dataBase64 = "bmV3";
  f.body.history.push({ role: "user", content: "Mude para outra loja" });
  release();
  await pending;
  assert.equal(f.requests.length, 3);
  assert.ok(!JSON.stringify(f.requests[1].messages).includes("Mude para outra loja"));
  assert.ok(!JSON.stringify(f.requests[1].messages).includes("Explique Fibonacci"));
  assert.deepEqual(f.calls, ["classifier", "attachment", "oneBuyClick", "main", "output-review", "cart"]);
});
test("attachment failure after approval never runs main or oneBuyClick and never retries classification", async t => {
  const f = fixture(t, "STORE_COMMERCE", { attachmentFailure: true });
  await assert.rejects(f.controller.sendMessage("cart", f.body, f.request), /synthetic-attachment-failure/);
  assert.deepEqual(f.calls, ["classifier", "attachment"]);
  assert.equal(f.requests.length, 1);
});
test("prepared late context cannot replace buyer identity, scope or classified text", async t => {
  const f = fixture(t, "STORE_COMMERCE");
  const prepared = await f.agent.prepare({ userMessage: "Quero um produto", merchantId: "store", sessionId: "cart", storeCategory: "books", history: [] });
  assert.ok(prepared.allowed);
  await assert.rejects(prepared.run({ merchantId: "foreign", userMessage: "Explique Fibonacci" } as never));
  await assert.rejects(prepared.run(), /storefront_prepared_turn_consumed/);
  assert.deepEqual(f.calls, ["classifier"]);
});
test("ordinary allowed text defers oneBuyClick as well and never loads an attachment", async t => {
  const f = fixture(t, "STORE_SUPPORT");
  const { attachment: _attachment, ...body } = f.body;
  await f.controller.sendMessage("cart", { ...body, user_message: "Qual é a política de devolução da loja?" }, f.request);
  assert.deepEqual(f.calls, ["classifier", "oneBuyClick", "main", "output-review", "cart"]);
  assert.equal(f.requests.length, 3);
});
test("the exact frontend attachment-only default preserves visual catalog search and confirmation context", async t => {
  const f = fixture(t, "STORE_COMMERCE");
  const frontendDefault = "Analise este anexo, encontre produtos iguais ou semelhantes disponíveis e me pergunte antes de adicionar qualquer item ao carrinho.";
  f.body.user_message = frontendDefault;
  await f.controller.sendMessage("cart", f.body, f.request);
  assert.equal(JSON.parse(f.requests[0].messages[1].content!).userMessage, frontendDefault);
  assert.ok(JSON.stringify(f.requests[1].messages).includes(frontendDefault));
  assert.ok(JSON.stringify(f.requests[1].messages).includes("Shampoo sintético"));
  assert.deepEqual(f.calls, ["classifier", "attachment", "oneBuyClick", "main", "output-review", "cart"]);
});
test("an ambiguous photo caption asks clarification before any visual provider or metadata initialization", async t => {
  const f = fixture(t, "UNCLEAR");
  f.body.user_message = "veja esta foto";
  assert.equal((await f.controller.sendMessage("cart", f.body, f.request)).message, STOREFRONT_SCOPE_CLARIFICATION_MESSAGE);
  assert.deepEqual(f.calls, ["classifier"]);
});
