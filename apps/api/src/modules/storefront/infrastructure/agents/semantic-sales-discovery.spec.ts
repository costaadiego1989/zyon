import test from "node:test";
import assert from "node:assert/strict";
import { StorefrontLangGraphAgent } from "./store-langgraph-agent.js";
import { shoppingSearchEvidence } from "../../application/services/shopping-search-evidence.js";
import { ensureProductDiscovery } from "./product-discovery-fallback.js";
import { storefrontIntentOutputSchema } from "../../domain/contracts/storefront-intent.schemas.js";

const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };
const need = { role: "user" as const, content: "Quero um produto para minha pele" };
const question = { question: "Como você descreveria sua pele?", replies: ["Oleosa", "Seca", "Mista", "Sensível"] };
const classification = { schemaVersion: 2, domain: "STORE_COMMERCE", intent: "PRODUCT_SEARCH", confidence: 1,
  requiresTool: true, needsProductDiscovery: true };

for (const userMessage of ["Quero uma ajuda para escolher ainda não sei o produto que eu quero", "Não sei escolher",
  "Pode me orientar?", "Tanto faz, me ajude a escolher"]) {
  test(`semantic discovery keeps the current skin need without a premature search: ${userMessage}`, async () => {
    const calls: string[] = [];
    let reads = 0, writes = 0;
    const history = [need, { role: "assistant" as const, content: "Posso ajudar você a escolher um cuidado." }];
    const original = structuredClone(history);
    const agent = new StorefrontLangGraphAgent({ structuredRouting: true, provider: { chat: async request => {
      const id = JSON.parse(request.messages[0]!.content!).id;
      calls.push(id ?? "main");
      if (id === "storefront.intent") {
        const contract = JSON.parse(request.messages[0]!.content!);
        const current = JSON.parse(request.messages[1]!.content!);
        assert.equal(current.userMessage, userMessage);
        assert.deepEqual(current.history, history);
        // The baseline V2 classifier did not request this decision. Emulate
        // its real valid envelope there, rather than fail on an unknown field.
        return { content: JSON.stringify({ ...classification,
          ...(contract.output.shoppingPhase ? { shoppingPhase: "clarify" } : {}) }), usage };
      }
      if (id === "storefront.shopping-plan") assert.fail("no search plan before the need is clarified");
      if (id === "storefront.reply-review") return { content: JSON.stringify({ schemaVersion: 1, verdict: "ALLOW", confidence: 1 }), usage, finishReason: "stop" };
      assert.match(request.messages[0]!.content!, /TURNO DE DESCOBERTA/);
      assert.ok(request.messages.some(message => message.content === need.content));
      assert.deepEqual(request.tools?.map(tool => tool.function.name), ["ask_product_preferences"]);
      return { content: "", toolCalls: [{ id: "ask-profile", name: "ask_product_preferences", args: question }], usage };
    } }, toolHandlers: { searchProducts: async () => { reads++; assert.fail("no catalog dump"); },
      recommendProducts: async () => { reads++; assert.fail("no priced recommendation yet"); },
      addItemToCart: async () => { writes++; assert.fail("no cart consent"); },
      createCheckoutSession: async () => { writes++; assert.fail("no checkout consent"); } } as never });
    const result = await agent.run({ merchantId: "owned", sessionId: "same", cartId: "same", userMessage, history });
    assert.deepEqual(result.discoveryQuestion, question, JSON.stringify({ result, calls }));
    assert.equal(result.message, question.question);
    assert.deepEqual(result.toolsUsed, ["ask_product_preferences"]);
    assert.deepEqual(result.blocks, []);
    assert.equal(result.cartId, "same");
    assert.equal(result.safetyValidation.safe, true);
    assert.equal(reads, 0); assert.equal(writes, 0);
    assert.equal(calls.filter(id => id === "storefront.intent").length, 1);
    assert.equal(calls.includes("storefront.shopping-plan"), false);
    assert.deepEqual(history, original);
    const projected = await ensureProductDiscovery(result, { userMessage, history, merchantId: "owned",
      discoveryDecision: result.routing.needsProductDiscovery, structuredSearchRequired: result.routing.structuredSearchRequired,
      handlers: { searchProducts: async () => assert.fail("fallback cannot erase the valid question") } as never });
    assert.deepEqual(projected.discoveryQuestion, question);
  });
}

test("known profile and explicit budget use the existing immutable canonical search without another interview", async () => {
  let plans = 0, reads = 0, writes = 0;
  const history = [need, { role: "assistant" as const, content: question.question }, { role: "user" as const, content: "Oleosa e sem perfume" }];
  const agent = new StorefrontLangGraphAgent({ structuredRouting: true, provider: { chat: async request => {
    const id = JSON.parse(request.messages[0]!.content!).id;
    if (id === "storefront.intent") return { content: JSON.stringify({ ...classification,
      ...(JSON.parse(request.messages[0]!.content!).output.shoppingPhase ? { shoppingPhase: "search" } : {}) }), usage };
    assert.equal(id, "storefront.shopping-plan"); plans++;
    const current = JSON.parse(request.messages[1]!.content!);
    assert.deepEqual(current.history, history);
    return { content: JSON.stringify({ schemaVersion: 1, plan: { version: 1, query: "pele oleosa sem perfume",
      minPriceCents: null, maxPriceCents: 8000, minRating: null, attributes: [], sortBy: null, delivery: null, unsupportedCriteria: [] } }), usage };
  } }, toolHandlers: { recommendProducts: async ({ criteria }: any) => {
    reads++; assert.equal(criteria.maxPriceCents, 8000); assert.equal(criteria.query, "pele oleosa sem perfume");
    return { products: [], searchEvidence: shoppingSearchEvidence(criteria, 0) };
  }, searchProducts: async () => assert.fail("must not bypass canonical price"), addItemToCart: async () => { writes++; } } as never });
  const result = await agent.run({ merchantId: "owned", sessionId: "same", userMessage: "Pode procurar até R$80, não adicione nada", history });
  assert.equal(plans, 1); assert.equal(reads, 1); assert.equal(writes, 0);
  assert.equal(result.discoveryQuestion, undefined); assert.equal(result.safetyValidation.safe, true);
  assert.deepEqual(result.toolsUsed, ["search_products"]);
});

test("semantic shopping phase is classification only and cannot be attached to support/cart/payment or unknown phases", () => {
  for (const intent of ["ADD_CART", "ORDER_STATUS", "RETURN_REQUEST", "COMPLEX_QUESTION", "GREETING"]) {
    assert.equal(storefrontIntentOutputSchema.safeParse({ ...classification, intent, needsProductDiscovery: false,
      shoppingPhase: "clarify" }).success, false, intent);
  }
  assert.equal(storefrontIntentOutputSchema.safeParse({ ...classification, shoppingPhase: "add_to_cart" }).success, false);
  assert.equal(storefrontIntentOutputSchema.safeParse({ ...classification, domain: "STORE_SUPPORT", shoppingPhase: "clarify" }).success, false);
  assert.equal(storefrontIntentOutputSchema.safeParse(classification).success, true, "backward compatible historical classifications");
});

for (const [userMessage, domain, intent] of [
  ["Preciso de ajuda com meu pagamento", "STORE_COMMERCE", "COMPLEX_QUESTION"],
  ["Não sei como falar com o atendimento humano", "STORE_SUPPORT", "COMPLEX_QUESTION"],
  ["Quero adicionar o produto escolhido ao carrinho", "STORE_COMMERCE", "ADD_CART"],
] as const) {
  test(`sales context cannot hijack the current action/support: ${userMessage}`, async () => {
    let writes = 0, plans = 0;
    const agent = new StorefrontLangGraphAgent({ structuredRouting: true, provider: { chat: async request => {
      const id = JSON.parse(request.messages[0]!.content!).id;
      if (id === "storefront.intent") return { content: JSON.stringify({ ...classification, domain, intent,
        needsProductDiscovery: false, requiresTool: false,
        ...(JSON.parse(request.messages[0]!.content!).output.shoppingPhase ? { shoppingPhase: null } : {}) }), usage };
      if (id === "storefront.shopping-plan") { plans++; assert.fail("current turn is not product discovery"); }
      if (id === "storefront.reply-review") return { content: JSON.stringify({ schemaVersion: 1, verdict: "ALLOW", confidence: 1 }), usage, finishReason: "stop" };
      assert.equal(request.tools?.some(tool => tool.function.name === "ask_product_preferences"), false);
      return { content: JSON.stringify({ schemaVersion: 1, message: "Posso ajudar com essa etapa da loja." }), usage };
    } }, toolHandlers: { addItemToCart: async () => { writes++; assert.fail("test makes no product selection"); } } as never });
    const result = await agent.run({ merchantId: "owned", sessionId: "same", userMessage, history: [need] });
    assert.equal(result.discoveryQuestion, undefined); assert.equal(plans, 0); assert.equal(writes, 0);
    assert.equal(result.routing.needsProductDiscovery, false);
    assert.equal(result.routing.domain, domain); assert.equal(result.routing.intent, intent);
    assert.equal(result.safetyValidation.safe, true);
  });
}
