import test from "node:test";
import assert from "node:assert/strict";
import { createAllowedScopeAgent } from "./storefront-scope.fixture.js";

const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };
const input = { merchantId: "merchant", sessionId: "owned", cartId: "owned", history: [],
  userMessage: "Posso acumular a oferta do Kit Completo com frete grátis? Confira sem aplicar nenhum benefício.",
  merchantPolicy: { allowStackDiscountAndFreeShipping: false } };
const classification = { intent: "NEGOTIATE_PRICE" as const, requiresTool: true, needsProductDiscovery: false };
const reads = { listPromotions: async () => ({ promotions: [], coupons: [] }),
  getDailyDeals: async () => ({ deals: [{ id: "complete", name: "Kit Completo", price: 9000, originalPrice: 10000, inStock: true }] }) };
const reply = (message: string) => JSON.stringify({ schemaVersion: 1, message });
const inspectOwnedUpdate = async (args: { cartId: string; quantity: number }) => {
  assert.equal(args.cartId, "owned"); assert.equal(args.quantity, 2);
  return { status: "admitted" as const, cartId: "owned", quantity: 2,
    selection: { cartId: "owned", quantity: 2, variantId: "variant", optionItemIds: [], serviceSlotId: null } };
};

test("failed generated narration becomes current public facts without another provider call or conflicting cards", async () => {
  let calls = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: reads as never,
    provider: { chat: async () => { calls++; return { content: reply("Sobre acumular com frete grátis: a loja não permite combinar esses benefícios."), usage }; } } as never,
  }, classification);
  const result = await agent.run(input);
  assert.equal(calls, 1); assert.equal(agent.outputReviewRequests.length, 0);
  assert.equal(result.safetyValidation.safe, true); assert.equal(result.safetyValidation.reason, "canonical_commercial_fallback");
  assert.match(result.message, /90,00/); assert.match(result.message, /100,00/); assert.match(result.message, /não permite acumular/);
  assert.doesNotMatch(result.message, /Sobre acumular com frete grátis|reformular/); assert.deepEqual(result.blocks, []);
});

test("invalid model JSON is discarded, not repaired, while confirmed public facts remain available", async () => {
  let calls = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: reads as never,
    provider: { chat: async () => { calls++; return { content: "BENEFIT_GRANTED_UNSAFE_NOT_JSON", usage }; } } as never,
  }, classification);
  const result = await agent.run(input);
  assert.equal(calls, 1); assert.equal(agent.outputReviewRequests.length, 0);
  assert.equal(result.safetyValidation.reason, "canonical_commercial_fallback");
  assert.match(result.message, /90,00/); assert.doesNotMatch(result.message, /BENEFIT_GRANTED/); assert.deepEqual(result.blocks, []);
});

test("one failed required read keeps a limitation rather than presenting the other read as sufficient", async () => {
  const agent = createAllowedScopeAgent({ structuredRouting: true,
    toolHandlers: { ...reads, listPromotions: async () => ({ error: "unavailable" }) } as never,
    provider: { chat: async () => ({ content: reply("Frete grátis já foi aplicado."), usage }) } as never,
  }, classification);
  const result = await agent.run(input);
  assert.equal(result.safetyValidation.safe, false); assert.notEqual(result.safetyValidation.reason, "canonical_commercial_fallback");
  assert.doesNotMatch(result.message, /90,00|Condições consultadas|já foi aplicado/);
});

test("a denied write attempt cannot be hidden by a factual commercial fallback", async () => {
  let writes = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true,
    toolHandlers: { ...reads, createCheckoutSession: async () => { writes++; throw Error("NO_WRITE"); } } as never,
    provider: { chat: async () => ({ content: "", toolCalls: [{ id: "checkout", name: "create_checkout_session", args: { cartId: "owned" } }], usage }) } as never,
  }, classification);
  const result = await agent.run(input);
  assert.equal(writes, 0); assert.notEqual(result.safetyValidation.reason, "canonical_commercial_fallback");
  assert.doesNotMatch(result.message, /Condições consultadas|90,00/);
});

test("an uncertain update remains terminal unknown despite confirmed commercial reads", async () => {
  let calls = 0, writes = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true,
    toolHandlers: { ...reads, inspectCartQuantity: inspectOwnedUpdate,
      updateCartItem: async () => { writes++; throw Error("PRIVATE_WRITE_ACK_TIMEOUT"); } } as never,
    provider: { chat: async () => { calls++; return { content: "", toolCalls: [{ id: "update", name: "update_cart_item",
      args: { cartId: "owned", variantId: "variant", quantity: 2 } }], usage }; } } as never,
  }, classification);
  const result = await agent.run({ ...input, userMessage: "Mude a quantidade do produto no carrinho para 2 unidades." });
  assert.equal(calls, 1); assert.equal(writes, 1); assert.notEqual(result.safetyValidation.reason, "canonical_commercial_fallback");
  assert.match(result.message, /Não consegui confirmar a alteração/); assert.doesNotMatch(result.message, /PRIVATE_WRITE_ACK_TIMEOUT|Condições consultadas/);
});

test("a committed update keeps its canonical receipt and is not replaced by offer facts", async () => {
  let calls = 0, writes = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true,
    toolHandlers: { ...reads, inspectCartQuantity: inspectOwnedUpdate,
      updateCartItem: async () => { writes++; return { cartId: "owned", total: 120, itemCount: 2,
      items: [{ variantId: "variant", name: "Produto", quantity: 2, unitPrice: 60, lineTotal: 120 }] }; } } as never,
    provider: { chat: async () => { calls++; return { content: "", toolCalls: [{ id: "update", name: "update_cart_item",
      args: { cartId: "owned", variantId: "variant", quantity: 2 } }], usage }; } } as never,
  }, classification);
  const result = await agent.run({ ...input, userMessage: "Mude a quantidade do produto no carrinho para 2 unidades." });
  assert.equal(calls, 1); assert.equal(writes, 1); assert.notEqual(result.safetyValidation.reason, "canonical_commercial_fallback");
  assert.match(result.message, /Carrinho atualizado/); assert.doesNotMatch(result.message, /Condições consultadas/);
  assert.equal(result.blocks.some(block => block.type === "cart_summary"), true);
});

test("canonical projection still passes through the unchanged safety guard", async () => {
  const agent = createAllowedScopeAgent({ structuredRouting: true,
    toolHandlers: { ...reads, getDailyDeals: async () => ({ deals: [{ id: "bad", name: "Frete grátis já aplicado", price: 9000, inStock: true }] }) } as never,
    provider: { chat: async () => ({ content: reply("Frete grátis já aplicado."), usage }) } as never,
  }, classification);
  const result = await agent.run(input);
  assert.equal(result.safetyValidation.safe, false); assert.notEqual(result.safetyValidation.reason, "canonical_commercial_fallback");
  assert.doesNotMatch(result.message, /Frete grátis já aplicado|Condições consultadas/);
});
