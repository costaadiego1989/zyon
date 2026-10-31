import test from "node:test";
import assert from "node:assert/strict";
import { StorefrontLangGraphAgent } from "./store-langgraph-agent.js";
import { buildStoreSystemPrompt } from "../../domain/prompts/store-system-prompt.builder.js";
import { shoppingSearchEvidence } from "../../application/services/shopping-search-evidence.js";

const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };
const first = "Olá, boa noite. Gostaria de comprar um produto para minha pele";
const second = "Quero uma ajuda para escolher ainda não sei o produto que eu quero";
// Captured production outputs c7c6433b and1ca92983 on published F1D. These are
// deliberately BAD main responses, never a fixture that supplies a good question.
const liveBad = ["Claro! Você já tem algo em mente ou quer ajuda para escolher?",
  "Claro! Você já tem algum produto em mente ou quer ajuda para escolher?"];
const classified = { schemaVersion: 2, domain: "STORE_COMMERCE", intent: "RECOMMEND_PERSONALIZED", confidence: 1,
  requiresTool: true, needsProductDiscovery: true, shoppingPhase: "clarify" };
const generalCommerce = { ...classified, intent: "COMPLEX_QUESTION", requiresTool: false, needsProductDiscovery: false, shoppingPhase: null };

for (const classification of [classified, generalCommerce])
for (const [userMessage, history, bad] of [
  [first, [], liveBad[0]],
  [second, [{ role: "user", content: first }, { role: "assistant", content: liveBad[0] }], liveBad[1]],
] as const) test(`actual production need progresses despite the captured generic main proposal: ${classification.intent}/${userMessage}`, async () => {
  let main = 0, reads = 0, writes = 0;
  const phases: string[] = [];
  const provider = { chat: async (request: any) => {
    const prompt = JSON.parse(request.messages[0].content); phases.push(prompt.id);
    if (prompt.id === "storefront.intent") return { content: JSON.stringify(classification), usage, finishReason: "stop" };
    if (prompt.id === "storefront.reply-review") return { content: JSON.stringify({ schemaVersion: 1, verdict: "ALLOW", confidence: 1 }), usage, finishReason: "stop" };
    assert.equal(prompt.id, "storefront.sales");
    // Consume the REAL builder/prompt used by the production agent. The old
    // example matches the first captured output exactly; no injected good copy.
    assert.equal(prompt.operatingInstructions, JSON.parse(buildStoreSystemPrompt({ merchantName: "Athom" })).operatingInstructions);
    main++;
    return { content: JSON.stringify({ schemaVersion: 1, message: bad }), usage, finishReason: "stop" };
  } };
  const agent = new StorefrontLangGraphAgent({ structuredRouting: true, provider, toolHandlers: {
    searchProducts: async () => { reads++; assert.fail("profile not known yet"); },
    recommendProducts: async () => { reads++; assert.fail("no catalog dump"); },
    addItemToCart: async () => { writes++; assert.fail("no selection"); },
  } as never });
  const result = await agent.run({ merchantId: "owned", merchantName: "Athom", sessionId: "same", cartId: "same", userMessage, history: structuredClone(history) as any });
  assert.match(result.message, /pele/);
  assert.doesNotMatch(result.message, /algo em mente|algum produto em mente|quer ajuda/i);
  assert.equal((result.message.match(/\?/g) ?? []).length, 1);
  assert.deepEqual(result.discoveryQuestion?.replies, ["Oleosa", "Seca", "Mista", "Sensível"]);
  assert.equal(result.safetyValidation.safe, true);
  assert.deepEqual(result.blocks, []); assert.equal(result.cartId, "same");
  assert.equal(reads, 0); assert.equal(writes, 0);
  assert.equal(main, 0, "known-area clarification needs no speculative narration/retry/review");
  assert.deepEqual(phases, ["storefront.intent"]);
});

test("unknown profile progresses once to a different question, then to a bounded non-interview fallback", async () => {
  const history: Array<{role:"user"|"assistant";content:string}> = [{ role: "user", content: first },
    { role: "assistant", content: "Como você descreveria sua pele?" }];
  const agent = new StorefrontLangGraphAgent({ structuredRouting: true, provider: { chat: async request => {
    assert.equal(JSON.parse(request.messages[0]!.content!).id, "storefront.intent");
    return { content: JSON.stringify(generalCommerce), usage };
  } }, toolHandlers: {} as never });
  const next = await agent.run({ merchantId: "owned", sessionId: "same", userMessage: "Não sei", history });
  assert.equal(next.discoveryQuestion?.question, "Qual cuidado você quer priorizar para a pele?");
  assert.doesNotMatch(next.message, /descreveria|quer ajuda/);
  history.push({role:"user",content:"Não sei"},{role:"assistant",content:next.message});
  const limited = await agent.run({ merchantId: "owned", sessionId: "same", userMessage: "Não sei", history });
  assert.equal(limited.discoveryQuestion, undefined); assert.doesNotMatch(limited.message, /\?/);
  assert.match(limited.message, /características publicadas/); assert.deepEqual(limited.blocks, []);
});

for (const [message, domain, requiresTool] of [
  ["Não quero comprar", "STORE_COMMERCE", false],
  ["Não quero ajuda para escolher", "STORE_COMMERCE", false],
  ["Vou pensar se quero ajuda para escolher", "STORE_COMMERCE", false],
  ["Pode me ajudar a saber o preço desse sérum?", "STORE_COMMERCE", true],
  ["Preciso de ajuda com meu pedido", "STORE_SUPPORT", false],
  ["Adicione o sérum ao carrinho", "STORE_COMMERCE", false],
] as const) test(`care history cannot turn a refusal, factual question or other action into an interview: ${message}`, async () => {
  let main = 0;
  const agent = new StorefrontLangGraphAgent({ structuredRouting: true, provider: { chat: async request => {
    const id = JSON.parse(request.messages[0]!.content!).id;
    if (id === "storefront.intent") return { content: JSON.stringify({ ...generalCommerce, domain, requiresTool }), usage };
    if (id === "storefront.reply-review") return { content: JSON.stringify({ schemaVersion: 1, verdict: "ALLOW", confidence: 1 }), usage, finishReason: "stop" };
    assert.equal(id, "storefront.sales"); main++;
    assert.equal(request.tools?.some(tool=>tool.function.name==="ask_product_preferences"), false);
    return { content: JSON.stringify({schemaVersion:1,message:"Posso ajudar com a etapa solicitada da loja."}), usage };
  } }, toolHandlers: {} as never });
  const result = await agent.run({ merchantId:"owned",sessionId:"same",userMessage:message,history:[{role:"user",content:first}] });
  assert.equal(result.discoveryQuestion, undefined); assert(main>0);
});

test("a known skin profile keeps canonical budget/negative constraints even if the classifier asks for clarification", async () => {
  let reads = 0, plans = 0;
  const history = [{ role: "user" as const, content: "Quero um produto para pele oleosa sem perfume, até R$80" }];
  const agent = new StorefrontLangGraphAgent({ structuredRouting: true, provider: { chat: async request => {
    const id = JSON.parse(request.messages[0]!.content!).id;
    if (id === "storefront.intent") return { content: JSON.stringify(classified), usage };
    assert.equal(id, "storefront.shopping-plan"); plans++;
    assert.deepEqual(JSON.parse(request.messages[1]!.content!).history, history);
    return { content: JSON.stringify({ schemaVersion: 1, plan: { version: 1, query: "pele oleosa sem perfume",
      minPriceCents: null, maxPriceCents: 8000, minRating: null, attributes: [], sortBy: null, delivery: null, unsupportedCriteria: [] } }), usage };
  } }, toolHandlers: { recommendProducts: async ({ criteria }: any) => { reads++; assert.equal(criteria.maxPriceCents, 8000);
    assert.match(criteria.query, /sem perfume/); return { products: [], searchEvidence: shoppingSearchEvidence(criteria, 0) }; } } as never });
  const result = await agent.run({ merchantId: "owned", sessionId: "same", userMessage: "Pode me ajudar a escolher?", history });
  assert.equal(result.discoveryQuestion, undefined); assert.equal(plans, 1); assert.equal(reads, 1);
  assert.equal(result.safetyValidation.safe, true);
});
