import assert from "node:assert/strict";
import test from "node:test";
import { buildExecutableStoreTools, buildStoreTools } from "./index.js";
import type { StoreToolHandlers } from "./types.js";

const validCart = { cartId: "conversation", items: [{ variantId: "variant", name: "Produto", quantity: 2, unitPrice: 10, lineTotal: 20 }], total: 20, itemCount: 2 };

function fixture() {
  const calls: unknown[] = [];
  const handlers = new Proxy({} as StoreToolHandlers, {
    get: () => async (args: unknown) => { calls.push(args); return validCart; },
  });
  const tools = buildExecutableStoreTools({ merchantId: "merchant", sessionId: "conversation", handlers });
  return { calls, tools, run: (name: string, args: unknown) => {
    const tool = tools.find(tool => tool.name === name);
    assert.ok(tool); return tool.execute(args as Record<string, unknown>);
  } };
}

for (const [name, args] of [
  ["add_item_to_cart", { variantId: "variant", quantity: -1 }],
  ["add_item_to_cart", { variantId: "variant", quantity: 1.5 }],
  ["add_item_to_cart", { variantId: "variant", quantity: "2" }],
  ["add_item_to_cart", { variantId: "variant", quantity: 1, price: 0 }],
  ["update_cart_item", { cartId: "conversation", variantId: "variant", quantity: -1 }],
  ["search_products", { query: "livro", sortBy: "unsafe" }],
  ["search_products", { query: "livro", limit: -1 }],
  ["get_product_details", { productId: "" }],
  ["create_review", { productId: "book", rating: 6, text: "Boa", authorName: "Buyer", authorPhone: "11999990000" }],
  ["clear_cart", { cartId: "conversation", merchantId: "foreign" }],
  ["quote_shipping", { zipCode: "01310100", productId: "unselected-product" }],
] as const) {
  test(`contract: ${name} rejects invalid arguments ${JSON.stringify(args)} before its handler`, async () => {
    const f = fixture();
    assert.deepEqual(await f.run(name, args), { ok: false, error: "invalid_tool_arguments", code: "invalid_tool_arguments" });
    assert.deepEqual(f.calls, []);
  });
}

test("contract: validated arguments preserve optional selection bindings without coercion", async () => {
  const f = fixture();
  const args = { variantId: "variant", quantity: 2, selectedOptionItemIds: ["option"], selectedServiceSlotId: "slot", crossSellPromoId: "promo" };
  assert.deepEqual(await f.run("add_item_to_cart", args), { ok: true, data: validCart });
  assert.deepEqual(f.calls, [args]);
});
test("contract: zero quantity carries exact line identity to the canonical handler", async () => {
  const f = fixture(), args = { cartId: "conversation", variantId: "variant", quantity: 0, optionItemIds: ["large"], serviceSlotId: "slot" };
  assert.deepEqual(await f.run("update_cart_item", args), { ok: true, data: validCart });
  assert.deepEqual(f.calls, [args]);
});

test("contract: every advertised tool rejects unknown fields before its handler", async () => {
  const f = fixture();
  assert.equal(f.tools.length, buildStoreTools().length);
  for (const tool of f.tools) {
    assert.deepEqual(await tool.execute({ __unexpected: "PRIVATE_ARGUMENT" }),
      { ok: false, error: "invalid_tool_arguments", code: "invalid_tool_arguments" }, tool.name);
  }
  assert.deepEqual(f.calls, []);
});

