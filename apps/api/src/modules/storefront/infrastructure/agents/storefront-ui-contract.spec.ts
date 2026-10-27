import test from "node:test";
import assert from "node:assert/strict";
import { executeStorefrontUiAction } from "./storefront-ui-action.executor.js";
import type { StoreToolHandlers } from "../../domain/tools/types.js";
import { storefrontUiActionSchema } from "../../domain/contracts/storefront-ui-action.schemas.js";

const cart = { cartId: "cart", items: [{ variantId: "v1", name: "Produto", quantity: 1, unitPrice: 10, lineTotal: 10 }], total: 10, itemCount: 1 };
const product = { id: "p1", name: "Produto", price: 1000, inStock: true };
const outputs: Record<string, unknown> = {
  addItemToCart: cart, getCart: cart, removeCartItem: cart, updateCartItem: cart,
  getProductDetails: { product }, searchProducts: { products: [product] }, listCategories: { categories: [] },
  getReviews: { reviews: [], totalCount: 0, averageRating: 0 }, getSimilarProducts: { products: [product] },
  compareProducts: { comparison: [{ ...product, attributes: {}, stock: 1 }] }, getDailyDeals: { deals: [product] },
  getWishlist: { items: [], message: "Sua lista" }, addToWishlist: { added: true, productId: "p1", items: [], message: "Salvo" },
  removeFromWishlist: { removed: true, productId: "p1", items: [], message: "Removido" },
  applyCoupon: { applied: false, reason: "invalid" }, createCheckoutSession: { budgetRequired: true, cartId: "cart", message: "Solicite orçamento" },
};
const actions = [
  { tool: "add_catalog_items", args: { lines: [{ variantId: "v1", quantity: 1 }] } },
  { tool: "get_product_details", args: { productId: "p1" } }, { tool: "search_products", args: {} },
  { tool: "list_categories", args: {} }, { tool: "get_reviews", args: { productId: "p1" } },
  { tool: "get_similar_products", args: { productId: "p1" } }, { tool: "compare_products", args: { productId: "p1" } },
  { tool: "get_daily_deals", args: {} }, { tool: "add_item_to_cart", args: { variantId: "v1", quantity: 1 } },
  { tool: "get_cart", args: {} }, { tool: "get_wishlist", args: {} }, { tool: "add_to_wishlist", args: { productId: "p1" } },
  { tool: "remove_from_wishlist", args: { productId: "p1" } }, { tool: "remove_cart_item", args: { variantId: "v1" } },
  { tool: "update_cart_item", args: { variantId: "v1", quantity: 1 } }, { tool: "apply_coupon", args: { couponCode: "PROMO" } },
  { tool: "create_checkout_session", args: {} },
] as const;

test("UI fixtures cover every supported action", () => {
  assert.deepEqual(storefrontUiActionSchema.options.map(schema => schema.shape.tool.value).sort(), actions.map(action => action.tool).sort());
});

for (const action of actions) {
  test(`UI contract accepts the canonical ${action.tool} action`, async () => {
    const calls: string[] = [];
    const handlers = new Proxy({} as StoreToolHandlers, { get: (_target, key: string) => async () => { calls.push(key); return outputs[key]; } });
    const result = await executeStorefrontUiAction(handlers, action as unknown as { tool: string; args: Record<string, unknown> }, "merchant", "cart");
    assert.ok(calls.length > 0);
    assert.doesNotMatch(result.message, /Não consegui confirmar|Não consegui concluir/);
  });
  test(`UI contract rejects extra fields for ${action.tool}`, async () => {
    let calls = 0;
    const handlers = new Proxy({} as StoreToolHandlers, { get: () => async () => { calls++; return {}; } });
    await executeStorefrontUiAction(handlers, { tool: action.tool, args: { ...action.args, injectedPrice: 0 } }, "merchant", "cart");
    assert.equal(calls, 0);
  });
}

for (const [tool, args] of [
  ["add_item_to_cart", { variantId: "v1", quantity: "2" }],
  ["add_item_to_cart", { variantId: "v1", quantity: 1, price: 0 }],
  ["add_item_to_cart", { variantId: "v1", quantity: 1, selectedOptionItemIds: ["option", 1] }],
  ["update_cart_item", { variantId: "v1", quantity: "3" }],
  ["get_cart", { cartId: "foreign" }],
  ["get_product_details", { productId: "" }],
  ["search_products", { query: "x", merchantId: "foreign" }],
  ["add_catalog_items", { lines: [{ variantId: "v1", quantity: 1 }, { variantId: "v2", quantity: "2" }] }],
  ["unsupported", {}],
] as const) {
  test(`UI contract rejects ${tool} ${JSON.stringify(args)} before any handler`, async () => {
    let calls = 0;
    const handlers = new Proxy({} as StoreToolHandlers, { get: () => async () => { calls++; return {}; } });
    const result = await executeStorefrontUiAction(handlers, { tool, args: args as Record<string, unknown> }, "merchant", "cart");
    assert.equal(calls, 0);
    assert.equal(result.blocks.length, 0);
    assert.match(result.message, /seleção|selecao/);
  });
}

test("UI defaults quantity without coercion and keeps the server cart binding", async () => {
  const calls: unknown[] = [];
  const cart = { cartId: "cart", items: [{ variantId: "v1", name: "Produto", quantity: 1, unitPrice: 10, lineTotal: 10 }], total: 10, itemCount: 1 };
  const handlers = { addItemToCart: async (args: unknown) => { calls.push(args); return cart; }, getCart: async () => cart } as unknown as StoreToolHandlers;
  await executeStorefrontUiAction(handlers, { tool: "add_item_to_cart", args: { variantId: "v1" } }, "merchant", "cart");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { cartId: "cart", variantId: "v1", quantity: 1, selectedServiceSlotId: undefined, selectedOptionItemIds: undefined });
});

test("UI invalid output after a write remains uncertain without replay or refresh", async () => {
  let writes = 0; let reads = 0;
  const handlers = { addItemToCart: async () => { writes++; return { cartId: "cart", total: "PRIVATE_RESULT", items: [] }; },
    getCart: async () => { reads++; return {}; } } as unknown as StoreToolHandlers;
  const result = await executeStorefrontUiAction(handlers, { tool: "add_item_to_cart", args: { variantId: "v1", quantity: 1 } }, "merchant", "cart");
  assert.equal(writes, 1); assert.equal(reads, 0);
  assert.match(result.message, /confirmar/);
  assert.doesNotMatch(result.message, /PRIVATE_RESULT/);
  assert.deepEqual(result.blocks, []);
});

test("UI rejects a foreign cart returned by a handler", async () => {
  const result = await executeStorefrontUiAction({ getCart: async () => ({ ...cart, cartId: "foreign" }) } as unknown as StoreToolHandlers,
    { tool: "get_cart", args: {} }, "merchant", "cart");
  assert.match(result.message, /confirmar/);
  assert.deepEqual(result.blocks, []);
});

