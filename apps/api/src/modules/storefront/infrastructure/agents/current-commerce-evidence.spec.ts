import test from "node:test";
import assert from "node:assert/strict";
import { createAllowedScopeAgent } from "./storefront-scope.fixture.js";
import { buildStoreSystemPrompt } from "../../domain/prompts/store-system-prompt.builder.js";
import { storefrontConversationInputSchema } from "../../domain/contracts/storefront-conversation.schemas.js";

const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };
const input = { merchantId: "merchant", sessionId: "owned", cartId: "owned", history: [], storeCategory: "others",
  userMessage: "Essa condição ainda está valendo? Não aplique nada." };
const reply = (message: string) => JSON.stringify({ schemaVersion: 1, message });
const classification = { domain: "STORE_COMMERCE" as const, intent: "COMPLEX_QUESTION" as const, requiresTool: true, needsProductDiscovery: false };

test("a required current-fact read cannot end only by promising a future consultation", async () => {
  let calls = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: {} as never,
    provider: { chat: async () => { calls++; return { content: reply("Vou conferir as condições antes de responder."), usage }; } } as never,
  }, classification);
  const result = await agent.run(input);
  assert.equal(calls, 2, "only the existing missing-tool retry is used");
  assert.deepEqual(result.toolsUsed, []); assert.deepEqual(result.blocks, []);
  assert.equal(result.safetyValidation.safe, false); assert.equal(result.safetyValidation.reason, "required_read_unconfirmed");
  assert.match(result.message, /Não consegui confirmar/); assert.doesNotMatch(result.message, /Vou conferir/);
});

test("an attempted but failed read does not count as current commercial evidence", async () => {
  let calls = 0, reads = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true,
    toolHandlers: { getDailyDeals: async () => { reads++; return { error: "temporarily_unavailable" }; } } as never,
    provider: { chat: async () => ++calls === 1
      ? { content: "", toolCalls: [{ id: "read", name: "get_daily_deals", args: {} }], usage }
      : { content: reply("Vou conferir e já respondo."), usage } } as never,
  }, classification);
  const result = await agent.run(input);
  assert.equal(reads, 1); assert.equal(calls, 2);
  assert.equal(result.safetyValidation.reason, "required_read_unconfirmed"); assert.deepEqual(result.blocks, []);
});

test("a confirmed empty conditions lookup supports an honest conclusion without granting an offer", async () => {
  let calls = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true,
    toolHandlers: { getDailyDeals: async () => ({ deals: [] }) } as never,
    provider: { chat: async () => ++calls === 1
      ? { content: "", toolCalls: [{ id: "read", name: "get_daily_deals", args: {} }], usage }
      : { content: reply("Não encontrei oferta ativa nessa consulta."), usage } } as never,
  }, classification);
  const result = await agent.run(input);
  assert.equal(calls, 2); assert.equal(result.safetyValidation.safe, true);
  assert.match(result.message, /Não encontrei oferta ativa/);
});

test("a pure price objection does not require re-reading or repeating historical offers", async () => {
  let calls = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: {} as never,
    provider: { chat: async () => { calls++; return { content: reply("Qual faixa de valor fica confortável para você?"), usage }; } } as never,
  }, { ...classification, intent: "NEGOTIATE_PRICE", requiresTool: false });
  const result = await agent.run({ ...input, userMessage: "Está caro para mim." });
  assert.equal(calls, 1); assert.equal(result.safetyValidation.safe, true); assert.deepEqual(result.toolsUsed, []);
});

test("stacking is a typed restriction: false denies and true still requires joint eligibility", () => {
  for (const value of [false, true]) {
    const context = storefrontConversationInputSchema.parse({ ...input,
      merchantPolicy: { allowStackDiscountAndFreeShipping: value } });
    assert.equal(context.merchantPolicy!.allowStackDiscountAndFreeShipping, value);
    const prompt = JSON.parse(buildStoreSystemPrompt({ merchantPolicy: context.merchantPolicy })).operatingInstructions;
    assert.match(prompt, value ? /permitido somente após validação conjunta/ : /Acumular desconto e isenção de frete: NÃO permitido/);
    assert.match(prompt, /true apenas permite avaliar, sem conceder/);
  }
  assert.equal(storefrontConversationInputSchema.safeParse({ ...input,
    merchantPolicy: { allowStackDiscountAndFreeShipping: "true" } }).success, false);
});

test("current commercial conditions are read and validated before the first narration, including a negative stacking rule", async () => {
  const reads: string[] = [];
  let calls = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: {
    listPromotions: async () => { reads.push("promotions"); return { promotions: [], coupons: [] }; },
    getDailyDeals: async () => { reads.push("deals"); return { deals: [] }; },
  } as never, provider: { chat: async request => {
    calls++; assert.deepEqual(reads, ["promotions", "deals"]);
    const evidence = request.messages.filter(message => message.role === "system").map(message => {
      try { return JSON.parse(message.content!); } catch { return undefined; }
    }).find(message => message?.id === "storefront.current-commercial-evidence");
    assert.equal(evidence.stackingAllowed, false);
    assert.deepEqual(evidence.conditions.get_daily_deals, { deals: [] });
    return { content: reply("A loja não permite acumular esses benefícios."), usage };
  } } as never }, { ...classification, intent: "NEGOTIATE_PRICE" });
  const result = await agent.run({ ...input, merchantPolicy: { allowStackDiscountAndFreeShipping: false } });
  assert.equal(calls, 1); assert.equal(result.safetyValidation.safe, true);
  assert.deepEqual(result.toolsUsed, ["list_promotions", "get_daily_deals"]);
});

test("failed and malformed prefetched reads do not confirm a condition or trigger a repair query", async () => {
  const reads: string[] = [];
  let calls = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: {
    listPromotions: async () => { reads.push("promotions"); return { error: "temporarily_unavailable" }; },
    getDailyDeals: async () => { reads.push("deals"); return { deals: [{ id: "incomplete" }] }; },
  } as never, provider: { chat: async () => {
    calls++; return { content: reply("Vou conferir e depois retorno com as condições."), usage };
  } } as never }, { ...classification, intent: "NEGOTIATE_PRICE" });
  const result = await agent.run(input);
  assert.deepEqual(reads, ["promotions", "deals"]); assert.equal(calls, 1);
  assert.equal(result.safetyValidation.reason, "required_read_unconfirmed");
  assert.match(result.message, /Não consegui confirmar/); assert.deepEqual(result.blocks, []);
});

test("invalid JSON after current-fact prefetch remains fail-closed without narration repair or review", async () => {
  let calls = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: {
    listPromotions: async () => ({ promotions: [], coupons: [] }), getDailyDeals: async () => ({ deals: [] }),
  } as never, provider: { chat: async () => {
    calls++; return { content: "Condição confirmada!", usage };
  } } as never }, { ...classification, intent: "NEGOTIATE_PRICE" });
  const result = await agent.run(input);
  assert.equal(calls, 1); assert.equal(agent.outputReviewRequests.length, 0);
  assert.doesNotMatch(result.message, /Condição confirmada/);
  assert.deepEqual(result.toolsUsed, ["list_promotions", "get_daily_deals"]);
  assert.deepEqual(result.blocks, []);
});

test("a competitor price is not a discovery request or permission to write the cart", async () => {
  let calls = 0, writes = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: {
    listPromotions: async () => ({ promotions: [], coupons: [] }), getDailyDeals: async () => ({ deals: [] }),
    addItemToCart: async () => { writes++; throw Error("write_must_not_run"); },
  } as never, provider: { chat: async () => {
    calls++; return { content: reply("Não consigo verificar a oferta da outra loja. Posso comparar as características publicadas do item daqui."), usage };
  } } as never }, { ...classification, intent: "NEGOTIATE_PRICE" });
  const result = await agent.run({ ...input, userMessage: "Vi por R$ 50 em outra loja. Qual condição está valendo aqui? Não adicione nada." });
  assert.equal(calls, 1); assert.equal(writes, 0); assert.equal(result.safetyValidation.safe, true);
  assert.equal(result.routing.needsProductDiscovery, false);
  assert.deepEqual(result.toolsUsed, ["list_promotions", "get_daily_deals"]);
});
