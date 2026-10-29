import test from "node:test";
import assert from "node:assert/strict";
import { StorefrontLangGraphAgent } from "./store-langgraph-agent.js";
import { createAllowedScopeAgent } from "./storefront-scope.fixture.js";
import { FRACTIONAL_CART_QUANTITY_MESSAGE } from "../../domain/services/cart-quantity-input.js";

const message = "Mude a quantidade do Kit Organizador Essencial no carrinho para 1,5 unidade.";
const input = { merchantId: "merchant", sessionId: "cart", cartId: "cart", history: [], storeCategory: "others", userMessage: message };

test("real decimal cart regression is rejected before main, retry, lookup, lazy context or any write", async () => {
  const tokens: string[] = [];
  const handlers = new Proxy({}, { get() { assert.fail("no handler may be loaded for invalid quantity"); } });
  const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: handlers as never,
    provider: { chat: async () => assert.fail("no narration or repair call is needed") } as never,
  }, { domain: "STORE_COMMERCE", intent: "ADD_CART", requiresTool: true, needsProductDiscovery: false });
  const prepared = await agent.prepare({ ...input, callbacks: { onToken: token => { tokens.push(token); } } });
  assert.equal(prepared.allowed, false);
  if (prepared.allowed) assert.fail("must finish before late RAG/buyer context");
  assert.equal(prepared.result.message, FRACTIONAL_CART_QUANTITY_MESSAGE);
  assert.equal(prepared.result.safetyValidation.safe, true);
  assert.deepEqual(prepared.result.toolsUsed, []); assert.deepEqual(prepared.result.blocks, []);
  assert.deepEqual(tokens, [FRACTIONAL_CART_QUANTITY_MESSAGE]); assert.equal(agent.outputReviewRequests.length, 0);
  assert.equal(prepared.result.routing.needsProductDiscovery, false);
});

test("fractional-looking text does not bypass a denied domain classification", async () => {
  let calls = 0;
  const agent = new StorefrontLangGraphAgent({ structuredRouting: true, toolHandlers: {} as never,
    provider: { chat: async () => {
      calls++; return { content: JSON.stringify({ schemaVersion: 2, domain: "UNCLEAR", intent: "COMPLEX_QUESTION",
        confidence: 0.2, requiresTool: false, needsProductDiscovery: false }),
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, finishReason: "stop" };
    } } as never });
  const result = await agent.run(input);
  assert.equal(calls, 1); assert.notEqual(result.message, FRACTIONAL_CART_QUANTITY_MESSAGE);
  assert.deepEqual(result.toolsUsed, []);
});
