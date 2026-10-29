import test from "node:test";
import assert from "node:assert/strict";
import type { OpenRouterChatRequest, OpenRouterProvider } from "@zyon/conversation-engine";
import { createAllowedScopeAgent } from "./storefront-scope.fixture.js";
import { STOREFRONT_REPLY_CONTRACT_REMINDER, withStorefrontReplyContract } from "./storefront-reply-contract.js";
import { STOREFRONT_MODEL_FALLBACK } from "../../domain/contracts/storefront-model-output.schema.js";

const usage = { promptTokens: 5, completionTokens: 5, totalTokens: 10 };
const reply = (message: string) => JSON.stringify({ schemaVersion: 1, message });
const history = [{ role: "assistant" as const, content: "A opção Essencial custa R$ 60. Qual prefere?" }];
const input = { merchantId: "merchant", sessionId: "cart", cartId: "cart", history, userMessage: "Está caro para mim." };
function contract(request: OpenRouterChatRequest) {
  assert.equal(JSON.parse(request.messages[0]!.content!).id, "storefront.sales");
  assert.deepEqual(request.messages.at(-1), { role: "system", content: STOREFRONT_REPLY_CONTRACT_REMINDER });
  assert.equal(request.messages.filter(message => message.role === "system" && message.content === STOREFRONT_REPLY_CONTRACT_REMINDER).length, 1);
  assert.equal(request.responseFormat?.type, "json_object");
  assert.ok(request.messages.some(message => message.role === "assistant" && message.content === history[0].content));
  assert.ok(request.messages.some(message => message.role === "user" && message.content === input.userMessage));
}

test("contract guidance appends once without changing initial JSON, history, user text or tool correlation", () => {
  const messages = [
    { role: "system", content: '{"id":"storefront.sales"}' }, history[0],
    { role: "user", content: STOREFRONT_REPLY_CONTRACT_REMINDER },
    { role: "assistant", content: "", tool_calls: [{ id: "read", type: "function", function: { name: "list_promotions", arguments: "{}" } }] },
    { role: "tool", content: '{"promotions":[],"coupons":[]}', name: "list_promotions", tool_call_id: "read" },
  ] as never;
  const snapshot = structuredClone(messages);
  const once = withStorefrontReplyContract(messages);
  const twice = withStorefrontReplyContract(once);
  assert.deepEqual(messages, snapshot);
  assert.deepEqual(twice, once);
  assert.deepEqual(once.slice(0, -1), messages);
  assert.equal(once[0], messages[0]);
});

test("first main request gets the reminder while classifier and reply review retain their own contracts", async () => {
  let calls = 0;
  const agent = createAllowedScopeAgent({ toolHandlers: {} as never, provider: { chat: async request => {
    calls++; contract(request); return { content: reply("Qual faixa de valor fica confortável para você?"), usage };
  } } as OpenRouterProvider });
  const result = await agent.run(input);
  assert.equal(calls, 1);
  assert.equal(result.message, "Qual faixa de valor fica confortável para você?");
  assert.equal(agent.outputReviewRequests.length, 1);
  assert.equal(JSON.parse(agent.outputReviewRequests[0].messages[0].content!).id, "storefront.reply-review");
  assert.ok(!agent.outputReviewRequests[0].messages.some(message => message.content === STOREFRONT_REPLY_CONTRACT_REMINDER));
});

test("the next request after non-product reads still ends with the contract and preserves the tool result", async () => {
  let calls = 0, reads = 0;
  const agent = createAllowedScopeAgent({ toolHandlers: { listPromotions: async () => {
    reads++; return { promotions: [], coupons: [] };
  } } as never, provider: { chat: async request => {
    calls++; contract(request);
    if (calls === 1) return { content: "", toolCalls: [{ id: "read", name: "list_promotions", args: {} }], usage };
    assert.ok(request.messages.some(message => message.role === "tool" && message.tool_call_id === "read"));
    return { content: reply("Não encontrei cupom confirmado nessa consulta."), usage };
  } } as OpenRouterProvider });
  await agent.run(input);
  assert.equal(reads, 1); assert.equal(calls, 2);
});

test("required-tool retry and its final narration both receive the same transport reminder", async () => {
  let calls = 0, reads = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: { listPromotions: async () => {
    reads++; return { promotions: [], coupons: [] };
  } } as never, provider: { chat: async request => {
    calls++; contract(request);
    if (calls === 1) return { content: reply("Confira as condições disponíveis."), usage };
    if (calls === 2) return { content: "", toolCalls: [{ id: "read", name: "list_promotions", args: {} }], usage };
    assert.ok(request.messages.some(message => message.role === "tool" && message.tool_call_id === "read"));
    return { content: reply("Não há cupom confirmado nessa consulta."), usage };
  } } as OpenRouterProvider }, { domain: "STORE_COMMERCE", intent: "COMPLEX_QUESTION", requiresTool: true, needsProductDiscovery: false });
  await agent.run(input);
  assert.equal(calls, 3); assert.equal(reads, 1);
});

test("fallback provider gets the reminder before and after its read without altering the initial system", async () => {
  let primary = 0, fallback = 0, reads = 0;
  const agent = createAllowedScopeAgent({ toolHandlers: { listPromotions: async () => {
    reads++; return { promotions: [], coupons: [] };
  } } as never, provider: { chat: async request => { primary++; contract(request); throw Error("synthetic_provider_unavailable"); } } as unknown as OpenRouterProvider,
  fallbackProvider: { chat: async request => {
    fallback++; contract(request);
    if (fallback === 1) return { content: "", toolCalls: [{ id: "fallback-read", name: "list_promotions", args: {} }], usage };
    assert.ok(request.messages.some(message => message.role === "tool" && message.tool_call_id === "fallback-read"));
    return { content: reply("Quer conferir uma opção dentro do seu orçamento?"), usage };
  } } as OpenRouterProvider });
  await agent.run(input);
  assert.equal(primary, 1); assert.equal(fallback, 2); assert.equal(reads, 1);
});

test("invalid whitespace is still rejected once, without repair, retry, fallback provider or business effect", async () => {
  let calls = 0, fallback = 0;
  const agent = createAllowedScopeAgent({ toolHandlers: {} as never, provider: { chat: async request => {
    calls++; contract(request); return { content: " ".repeat(56), finishReason: "stop", usage };
  } } as OpenRouterProvider, fallbackProvider: { chat: async () => { fallback++; throw Error("must_not_retry_invalid_output"); } } as unknown as OpenRouterProvider });
  const result = await agent.run(input);
  assert.equal(calls, 1); assert.equal(fallback, 0);
  assert.equal(result.message, STOREFRONT_MODEL_FALLBACK);
  assert.equal(agent.outputReviewRequests.length, 0);
  assert.deepEqual(result.toolsUsed, []);
});
