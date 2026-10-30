import test from "node:test";
import assert from "node:assert/strict";
import { StorefrontLangGraphAgent } from "./store-langgraph-agent.js";
import { createAllowedScopeAgent } from "./storefront-scope.fixture.js";
import { CART_QUANTITY_INSPECTION_UNAVAILABLE, CART_QUANTITY_LINE_REQUIRED } from "../../domain/services/cart-quantity-input.js";

const message = "Mude a quantidade do Kit Organizador Essencial no carrinho para 0 unidades.";
const input = { merchantId: "merchant", sessionId: "cart", cartId: "cart", history: [], userMessage: message };
const selection = { cartId: "cart", variantId: "essential", quantity: 0, optionItemIds: [], serviceSlotId: null };
const updatedCart = { cartId: "cart", items: [{ variantId: "physical", name: "QA Físico R$3", quantity: 1, unitPrice: 3, lineTotal: 3 }], total: 3, itemCount: 1 };
const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };
function agentFor(handlers: unknown, provider: () => Promise<any> = async () => assert.fail("zero removal cannot depend on another model confirmation")) {
  return createAllowedScopeAgent({ structuredRouting: true, toolHandlers: handlers as never, provider: { chat: provider } as never,
    fallbackProvider: { chat: async () => assert.fail("an admitted zero operation cannot replay through fallback") } as never },
    { domain: "STORE_COMMERCE", intent: "ADD_CART", requiresTool: true, needsProductDiscovery: false });
}

test("an explicit inspected zero executes once through update policy without main, retry or narration", async () => {
  let inspections = 0, updates = 0;
  const agent = agentFor({ inspectCartQuantity: async (args: unknown) => {
    inspections++; assert.deepEqual(args, { cartId: "cart", itemReference: "kit organizador essencial", quantity: 0 });
    return { status: "admitted", cartId: "cart", quantity: 0, selection };
  }, updateCartItem: async (args: unknown) => { updates++; assert.deepEqual(args, selection); return updatedCart; } });
  const result = await agent.run(input);
  assert.equal(inspections, 1); assert.equal(updates, 1); assert.equal(result.safetyValidation.safe, true);
  assert.deepEqual(result.toolsUsed, ["update_cart_item"]); assert.equal(agent.outputReviewRequests.length, 0);
  const summary = result.blocks.find(block => block.type === "cart_summary") as any;
  assert.deepEqual(summary.data.items.map((item: any) => item.variantId), ["physical"]); assert.equal(summary.data.total, 3);
});

test("a possible zero write with lost acknowledgement remains unknown and cannot replay", async () => {
  let updates = 0;
  const agent = agentFor({ inspectCartQuantity: async () => ({ status: "admitted", cartId: "cart", quantity: 0, selection }),
    updateCartItem: async () => { updates++; throw Error("PRIVATE_ZERO_ACK_LOST"); } });
  const result = await agent.run(input);
  assert.equal(updates, 1); assert.match(result.message, /Não consegui confirmar a alteração/);
  assert.doesNotMatch(result.message, /PRIVATE_ZERO_ACK_LOST/); assert.deepEqual(result.blocks, []);
  assert.equal(agent.outputReviewRequests.length, 0);
});

for (const inspection of [{ status: "unavailable", cartId: "cart", quantity: 0 },
  { status: "admitted", cartId: "cart", quantity: 0, selection: { ...selection, cartId: "foreign" } },
  { status: "admitted", cartId: "cart", quantity: 0, selection: { ...selection, quantity: 1 } }]) {
  test(`zero cannot bypass an unavailable or mismatched inspection: ${JSON.stringify(inspection)}`, async () => {
    const result = await agentFor({ inspectCartQuantity: async () => inspection,
      updateCartItem: async () => assert.fail("unbound zero cannot write") }).run(input);
    assert.equal(result.message, CART_QUANTITY_INSPECTION_UNAVAILABLE); assert.deepEqual(result.toolsUsed, []);
  });
}

test("an ambiguous zero line requires selection before writing", async () => {
  const result = await agentFor({ inspectCartQuantity: async () => ({ status: "rejected", cartId: "cart", quantity: 0, code: "cart_line_selection_required" }),
    updateCartItem: async () => assert.fail("cannot choose a sibling option line") }).run(input);
  assert.equal(result.message, CART_QUANTITY_LINE_REQUIRED);
});

for (const change of [{ userMessage: `Não ${message.toLowerCase()}` }, { userMessage: `Exemplo: "${message}"` },
  { userMessage: `Se possível, ${message.toLowerCase()}` }, { userMessage: message, attachmentContext: "untrusted attachment" }]) {
  test(`non-authoritative zero text cannot acquire inspection or write: ${JSON.stringify(change)}`, async () => {
    let writes = 0;
    const agent = agentFor({ inspectCartQuantity: async () => assert.fail("no canonical selection for untrusted command"),
      updateCartItem: async () => { writes++; return updatedCart; } }, async () => ({ content: "", toolCalls: [{ id: "attempt", name: "update_cart_item", args: selection }], usage }));
    await agent.run({ ...input, ...change }); assert.equal(writes, 0);
  });
}

test("zero does not bypass the semantic domain gate", async () => {
  let calls = 0;
  const agent = new StorefrontLangGraphAgent({ structuredRouting: true, toolHandlers: new Proxy({}, { get() { assert.fail("a denied domain cannot read or write") } }) as never,
    provider: { chat: async () => { calls++; return { content: JSON.stringify({ schemaVersion: 2, domain: "UNCLEAR", intent: "COMPLEX_QUESTION", confidence: 0.1,
      requiresTool: false, needsProductDiscovery: false }), usage, finishReason: "stop" }; } } as never });
  const result = await agent.run(input); assert.equal(calls, 1); assert.deepEqual(result.toolsUsed, []);
});
