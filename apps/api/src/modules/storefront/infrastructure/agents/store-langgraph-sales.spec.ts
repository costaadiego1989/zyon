import test from "node:test";
import assert from "node:assert/strict";
import type { OpenRouterChatRequest, OpenRouterProvider } from "@zyon/conversation-engine";
import { StorefrontLangGraphAgent } from "./store-langgraph-agent.js";

const usage = { promptTokens: 20, completionTokens: 10, totalTokens: 30 };

test("vague purchase instructions survive primary and fallback routing without losing the shared sales policy", async () => {
  for (const failover of [false, true]) {
    const requests: OpenRouterChatRequest[] = [];
    const respond = async (request: OpenRouterChatRequest) => {
      requests.push(request);
      return { content: "Claro! Você já tem algo em mente ou quer ajuda para escolher?", toolCalls: [], usage };
    };
    const agent = new StorefrontLangGraphAgent({
      provider: { chat: failover ? async () => { throw Error("primary_unavailable"); } : respond } as unknown as OpenRouterProvider,
      fallbackProvider: { chat: respond } as unknown as OpenRouterProvider,
      toolHandlers: {} as never,
    });
    const result = await agent.run({ merchantId: "qa", sessionId: "qa", storeCategory: "electronics", history: [], userMessage: "quero comprar um produto" });
    assert.equal(requests.length, 1);
    const prompt = requests[0]!.messages[0]!.content;
    assert.match(prompt, /TURNO DE DESCOBERTA/);
    assert.match(prompt, /Não chame ferramentas para listar produtos, adicionar ao carrinho ou iniciar checkout/);
    assert.match(prompt, /vendedor consultivo profissional/);
    assert.match(prompt, /produtos retornados pelas ferramentas prevalecem/);
    assert.deepEqual(result.toolsUsed, []);
    assert.deepEqual(result.blocks, []);
    assert.equal(result.safetyValidation.safe, true);
  }
});

test("a disobedient provider cannot turn an object-free purchase into an arbitrary cart write", async () => {
  let writes = 0;
  const agent = new StorefrontLangGraphAgent({
    provider: { chat: async () => ({ content: "", toolCalls: [{ id: "wrong_add", name: "add_item_to_cart", args: { cartId: "qa", variantId: "arbitrary", quantity: 1 } }], usage }) } as unknown as OpenRouterProvider,
    toolHandlers: { addItemToCart: async () => { writes++; return { cartId: "qa", items: [{ variantId: "arbitrary", quantity: 1 }] }; } } as never,
  });
  const result = await agent.run({ merchantId: "qa", sessionId: "qa", storeCategory: "others", history: [], userMessage: "Quero comprar algo" });
  assert.equal(writes, 0);
  assert.equal(result.blocks.some(block => ["checkout_redirect", "checkout_prepared", "cart_summary"].includes(block.type)), false);
  assert.doesNotMatch(result.message, /adicionado ao carrinho!/);
});

test("specific follow-ups keep the need and budget history without receiving the vague-turn restriction", async () => {
  let seen: OpenRouterChatRequest | undefined;
  const agent = new StorefrontLangGraphAgent({ provider: { chat: async (request: OpenRouterChatRequest) => {
    seen = request;
    return { content: "Vou considerar a hidratação e suas preferências na seleção.", toolCalls: [], usage };
  } } as unknown as OpenRouterProvider, toolHandlers: {} as never });
  await agent.run({ merchantId: "qa", sessionId: "qa", storeCategory: "others", userMessage: "Hidratação", history: [
    { role: "user", content: "Quero algo para pele oleosa, sem perfume, até R$ 80" },
    { role: "assistant", content: "Você procura limpeza ou hidratação?" },
  ] });
  assert.ok(seen);
  assert.equal(seen.messages.at(-1)!.content, "Hidratação");
  assert.match(seen.messages[1]!.content, /pele oleosa, sem perfume, até R\$ 80/);
  assert.doesNotMatch(seen.messages[0]!.content, /TURNO DE DESCOBERTA/);
});

test("product-result guidance reaches primary and fallback replies without an additional provider call", async () => {
  for (const failover of [false, true]) {
    let calls = 0;
    const respond = async (request: OpenRouterChatRequest) => {
      calls++;
      assert.equal(request.temperature, 0.2);
      if (calls === 1) return { content: "", toolCalls: [{ id: "search", name: "search_products", args: { query: "hidratante sem perfume", limit: 3 } }], usage };
      assert.match(request.messages.at(-1)!.content, /RESPOSTA APÓS CONSULTAR PRODUTOS/);
      assert.match(request.messages.at(-1)!.content, /Não complete com conhecimento genérico/);
      assert.match(request.messages.at(-1)!.content, /Volume não informa embalagem/);
      return { content: "Esta opção tem textura leve e não contém perfume. Quer ver os detalhes?", toolCalls: [], usage };
    };
    const agent = new StorefrontLangGraphAgent({ provider: { chat: failover ? async () => { throw Error("primary_unavailable"); } : respond } as unknown as OpenRouterProvider,
      fallbackProvider: { chat: respond } as unknown as OpenRouterProvider,
      toolHandlers: { searchProducts: async () => ({ products: [{ id: "qa", name: "Hidratante QA", price: 7900, inStock: true, variants: [], images: [], description: "Textura leve, sem perfume" }] }) } as never,
    });
    const result = await agent.run({ merchantId: "qa", sessionId: "qa", storeCategory: "others", history: [], userMessage: "Quero um hidratante sem perfume" });
    assert.equal(calls, 2, "one lookup call and one reply, not an extra evaluation model");
    assert.deepEqual(result.toolsUsed, ["search_products"]);
    assert.equal(result.safetyValidation.safe, true);
  }
});
