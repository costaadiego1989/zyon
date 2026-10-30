import test from "node:test";
import assert from "node:assert/strict";
import { createCartHandlers } from "../tool-handlers/cart.handlers.js";
import { createCartTurnPolicy } from "../../domain/tools/cart-turn-policy.js";
import { validateStorefrontToolOutput } from "../../domain/contracts/storefront-tool-output.schemas.js";
import { createAllowedScopeAgent } from "./storefront-scope.fixture.js";
import { INSUFFICIENT_CART_STOCK_MESSAGE } from "../../domain/services/cart-quantity-input.js";

const message = "Mude a quantidade do Kit Organizador Essencial no meu carrinho para 20 unidades.";
const cart = { id: "row", sessionId: "cart", merchantId: "merchant", total: 6000, discount: 0, couponCode: null,
  items: [{ productId: "product", variantId: "essential", name: "Kit Organizador Essencial", sku: "QA", quantity: 1, unitPriceCents: 6000 }] };
const refusal = () => ({ error: "variant_out_of_stock", message: INSUFFICIENT_CART_STOCK_MESSAGE,
  notApplied: { cartId: "cart", variantId: "essential", quantity: 20 } });
const args = { cartId: "cart", variantId: "essential", quantity: 20 };
const inspected = async () => ({ status: "admitted", cartId: "cart", quantity: 20,
  selection: { ...args, optionItemIds: [], serviceSlotId: null } });

test("canonical stock rejects quantity20 before cart write and binds the not-applied result", async () => {
  let stockReads = 0;
  const handlers = createCartHandlers({
    cartRepo: { getOrCreate: async () => structuredClone(cart), updateItemQuantity: async () => assert.fail("insufficient stock cannot reach a write") },
    productRepo: { findById: async () => ({ isActive: true, type: "physical", variants: [{ id: "essential", isActive: true }] }) },
    stockRepo: { getAvailableStock: async (id: string) => { assert.equal(id, "essential"); stockReads++; return { quantity: 10, reserved: 0 }; } },
  } as never, { merchantId: "merchant", sessionId: "cart" });
  const result = await handlers.updateCartItem(args);
  assert.equal(stockReads, 1); assert.deepEqual((result as ReturnType<typeof refusal>).notApplied, refusal().notApplied);
  const validated = validateStorefrontToolOutput("update_cart_item", result, { cartId: "cart" });
  assert.equal(validated.ok, true); if (!validated.ok) assert.fail("canonical rejection must be typed");
  assert.deepEqual((validated.data as ReturnType<typeof refusal>).notApplied, refusal().notApplied);
});

test("reserved units are excluded from available stock before an update can write", async () => {
  const handlers = createCartHandlers({
    cartRepo: { getOrCreate: async () => structuredClone(cart), updateItemQuantity: async () => assert.fail("reserved units cannot be sold") },
    productRepo: { findById: async () => ({ isActive: true, type: "physical", variants: [{ id: "essential", isActive: true }] }) },
    stockRepo: { getAvailableStock: async () => ({ quantity: 10, reserved: 3 }) },
  } as never, { merchantId: "merchant", sessionId: "cart" });
  const result = await handlers.updateCartItem({ ...args, quantity: 8 });
  assert.equal(result.error, "variant_out_of_stock");
  assert.deepEqual(result.notApplied, { ...refusal().notApplied, quantity: 8 });
});

for (const stock of [{ quantity: NaN, reserved: 0 }, { quantity: Infinity, reserved: 0 }, { quantity: 10, reserved: NaN }]) {
  test(`invalid stock never becomes a confirmed admission rejection: ${JSON.stringify(stock)}`, async () => {
    const handlers = createCartHandlers({
      cartRepo: { getOrCreate: async () => structuredClone(cart), updateItemQuantity: async () => assert.fail("unverified stock cannot reach a write") },
      productRepo: { findById: async () => ({ isActive: true, type: "physical", variants: [{ id: "essential", isActive: true }] }) },
      stockRepo: { getAvailableStock: async () => stock },
    } as never, { merchantId: "merchant", sessionId: "cart" });
    const result = await handlers.updateCartItem(args);
    assert.equal(result.error, "stock_validation_unavailable");
    assert.equal("notApplied" in result, false);
  });
}

test("a correlated stock admission rejection is terminal and never becomes a success or retry", async () => {
  let calls = 0;
  const policy = createCartTurnPolicy(message, undefined, "cart");
  const [tool] = policy.wrap([{ name: "update_cart_item", execute: async () => { calls++; return { ok: true, data: refusal() }; } }]);
  await tool!.execute(args); await tool!.execute(args);
  assert.equal(calls, 1); assert.equal(policy.mutationOutcome?.status, "rejected");
  assert.equal(policy.mutationOutcome?.code, "variant_out_of_stock"); assert.equal(policy.hasUnknownWrite, false);
});

test("an explicit target20 cannot be silently lowered or converted to removal by the model", async () => {
  for (const quantity of [0, 1, 2, 21]) {
    const policy = createCartTurnPolicy(message, undefined, "cart");
    const [tool] = policy.wrap([{ name: "update_cart_item", execute: async () => assert.fail("substituted quantity cannot reach handler") }]);
    assert.equal((await tool!.execute({ ...args, quantity })).ok, false);
    assert.equal(policy.mutationOutcome?.status, "rejected");
  }
});

for (const notApplied of [undefined, { ...refusal().notApplied, cartId: "foreign" },
  { ...refusal().notApplied, variantId: "other" }, { ...refusal().notApplied, quantity: 2 },
  { ...refusal().notApplied, quantity: 0 }, { ...refusal().notApplied, quantity: 1.5 },
  { ...refusal().notApplied, afterWrite: true }]) {
  test(`unbound stock error stays uncertain: ${JSON.stringify(notApplied)}`, async () => {
    const policy = createCartTurnPolicy(message, undefined, "cart");
    const [tool] = policy.wrap([{ name: "update_cart_item", execute: async () => ({ ok: true,
      data: { error: "variant_out_of_stock", ...(notApplied ? { notApplied } : {}) } }) }]);
    await tool!.execute(args);
    assert.equal(policy.mutationOutcome?.status, "unknown"); assert.equal(policy.hasUnknownWrite, true);
  });
}

test("a timeout after a possible update remains terminal unknown, not a stock refusal", async () => {
  let attempts = 0;
  const policy = createCartTurnPolicy(message, undefined, "cart");
  const [tool] = policy.wrap([{ name: "update_cart_item", execute: async () => { attempts++; throw Error("PRIVATE_WRITE_ACK_TIMEOUT"); } }]);
  const result = await tool!.execute(args); await tool!.execute(args);
  assert.equal(attempts, 1); assert.equal(policy.mutationOutcome?.status, "unknown");
  assert.equal(policy.hasUnknownWrite, true); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_WRITE_ACK_TIMEOUT/);
});

test("a returned cart read resolves the line before quantity validation, without reconfirmation or model continuation", async () => {
  let main = 0, updates = 0;
  const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };
  const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: {
    inspectCartQuantity: inspected,
    getCart: async () => ({ cartId: "cart", items: [{ variantId: "essential", name: "Kit Organizador Essencial", quantity: 1, unitPrice: 60, lineTotal: 60 }], total: 60, itemCount: 1 }),
    updateCartItem: async (input: unknown) => { updates++; assert.deepEqual(input, { ...args, optionItemIds: [], serviceSlotId: null }); return refusal(); },
  } as never, provider: { chat: async () => {
    main++;
    if (main > 2) assert.fail("known admission rejection is terminal before generated narration");
    return { content: "", toolCalls: [{ id: String(main), name: main === 1 ? "get_cart" : "update_cart_item", args: main === 1 ? { cartId: "cart" } : args }], usage };
  } } as never }, { domain: "STORE_COMMERCE", intent: "ADD_CART", requiresTool: true, needsProductDiscovery: false });
  const result = await agent.run({ merchantId: "merchant", sessionId: "cart", cartId: "cart", history: [], userMessage: message });
  assert.equal(main, 2); assert.equal(updates, 1); assert.equal(result.message, INSUFFICIENT_CART_STOCK_MESSAGE);
  assert.equal(result.safetyValidation.safe, true); assert.deepEqual(result.blocks, []);
  assert.equal(agent.outputReviewRequests.length, 0);
});

test("a direct known stock rejection cannot be narrated as success or sent to another model", async () => {
  let main = 0, updates = 0;
  const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };
  const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: {
    inspectCartQuantity: inspected,
    updateCartItem: async () => { updates++; return refusal(); },
  } as never, provider: { chat: async () => {
    assert.equal(++main, 1, "the known refusal ends the provider loop");
    return { content: "", toolCalls: [{ id: "update", name: "update_cart_item", args }], usage };
  } } as never }, { domain: "STORE_COMMERCE", intent: "ADD_CART", requiresTool: true, needsProductDiscovery: false });
  const result = await agent.run({ merchantId: "merchant", sessionId: "cart", cartId: "cart", history: [], userMessage: message });
  assert.equal(updates, 1); assert.equal(result.message, INSUFFICIENT_CART_STOCK_MESSAGE);
  assert.equal(result.safetyValidation.safe, true); assert.deepEqual(result.blocks, []);
  assert.equal(agent.outputReviewRequests.length, 0);
});

test("an agent update with unknown outcome never uses the known-stock refusal copy", async () => {
  let main = 0, updates = 0;
  const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };
  const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: {
    inspectCartQuantity: inspected,
    updateCartItem: async () => { updates++; throw Error("PRIVATE_UNKNOWN_WRITE"); },
  } as never, provider: { chat: async () => {
    assert.equal(++main, 1, "uncertain update cannot continue or retry");
    return { content: "", toolCalls: [{ id: "update", name: "update_cart_item", args }], usage };
  } } as never }, { domain: "STORE_COMMERCE", intent: "ADD_CART", requiresTool: true, needsProductDiscovery: false });
  const result = await agent.run({ merchantId: "merchant", sessionId: "cart", cartId: "cart", history: [], userMessage: message });
  assert.equal(updates, 1); assert.match(result.message, /Não consegui confirmar a alteração/);
  assert.notEqual(result.message, INSUFFICIENT_CART_STOCK_MESSAGE); assert.deepEqual(result.blocks, []);
  assert.equal(agent.outputReviewRequests.length, 0);
});
