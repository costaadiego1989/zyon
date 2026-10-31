import test from "node:test";
import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { executeStorefrontUiAction } from "./storefront-ui-action.executor.js";
import { storefrontConversationOutputSchema } from "../../domain/contracts/storefront-conversation.schemas.js";

for (const batch of [false, true]) test(`confirmed ${batch ? "native catalog batch" : "single native add"} retains only its current cross-sell result`, async () => {
  const writes: string[] = [];
  const items: any[] = [];
  const payload = () => ({ cartId: "cart", items: [...items], total: items.length * 10, itemCount: items.length });
  const result = await executeStorefrontUiAction({
    addItemToCart: async ({ variantId }: any) => { writes.push(variantId); items.push({ variantId, name: variantId, quantity: 1, unitPrice: 10, lineTotal: 10 }); return {
      ...payload(), addedItem: { variantId, optionItemIds: [] }, crossSellSuggestions: [{ sku: `extra-${variantId}`, productId: `p-${variantId}`, name: `Complemento ${variantId}`, price: 5, recommendationRuleId: "current-rule" }],
    }; }, getCart: async () => payload(),
  } as any, batch ? { tool: "add_catalog_items", args: { lines: [{ variantId: "a", quantity: 1 }, { variantId: "b", quantity: 1 }] } }
    : { tool: "add_item_to_cart", args: { variantId: "a", quantity: 1 } }, "merchant", "cart");
  assert.deepEqual(writes, batch ? ["a", "b"] : ["a"]);
  const block: any = result.blocks.find(b => b.type === "cross_sell");
  assert.ok(block); assert.deepEqual(block.data.products.map((p: any) => p.id), [batch ? "extra-b" : "extra-a"]);
  assert.equal(block.data.products[0].recommendationRuleId, "current-rule");
  const output = storefrontConversationOutputSchema.safeParse({ ...result, cartId: "cart", suggestedNext: [] });
  assert.equal(output.success, true, output.success ? undefined : JSON.stringify(output.error.issues));
});

test("an uncertain later native batch write never replays the first add or projects its stale offer", async () => {
  const calls: string[] = [];
  const result = await executeStorefrontUiAction({ addItemToCart: async ({ variantId }: any) => {
    calls.push(variantId);
    if (variantId === "b") return {};
    return { cartId: "cart", items: [{ variantId, name: "A", quantity: 1, unitPrice: 10, lineTotal: 10 }], total: 10, itemCount: 1,
      addedItem: { variantId, optionItemIds: [] }, crossSellSuggestions: [{ sku: "b", productId: "p-b", name: "B", price: 5 }] };
  } } as any, { tool: "add_catalog_items", args: { lines: [{ variantId: "a", quantity: 1 }, { variantId: "b", quantity: 1 }] } }, "merchant", "cart");
  assert.deepEqual(calls, ["a", "b"]); assert.deepEqual(result.blocks, []);
});

test("a rejected product admission returns a recoverable conversation instead of blocking the turn", async () => {
  const result = await executeStorefrontUiAction({ addItemToCart: async () => { throw new BadRequestException("digital_content_unavailable"); } } as any,
    { tool: "add_item_to_cart", args: { variantId: "variant", quantity: 1 } }, "merchant", "cart");
  assert.match(result.message, /indisponível/); assert.equal(result.blocks.length, 0);
});

test("unknown commerce outcomes remain uncertain instead of being converted into a rejection", async () => {
  await assert.rejects(executeStorefrontUiAction({ addItemToCart: async () => { throw new Error("connection_lost_after_commit"); } } as any,
    { tool: "add_item_to_cart", args: { variantId: "variant", quantity: 1 } }, "merchant", "cart"), /connection_lost_after_commit/);
});

test("contextual navigation uses tenant-authorized handlers for recommendations, comparison and offers", async () => {
  const calls: any[] = [];
  const handlers = {
    getSimilarProducts: async (args: any) => { calls.push(["similar", args]); return { products: [{ id: "p2", name: "Similar", price: 1234, inStock: true }] }; },
    compareProducts: async (args: any) => { calls.push(["compare", args]); return { comparison: [{ id: "p1", name: "Original", price: 1200, attributes: {} }, { id: "p2", name: "Similar", price: 1234, attributes: {} }] }; },
    getDailyDeals: async () => { calls.push(["deals"]); return { deals: [{ id: "p2", name: "Oferta", price: 1000, inStock: true }] }; },
  } as any;
  for (const tool of ["get_similar_products", "compare_products", "get_daily_deals"]) {
    const result = await executeStorefrontUiAction(handlers, { tool, args: tool === "get_daily_deals" ? {} : { productId: "p1" } }, "merchant", "cart");
    assert.ok(result.blocks.length, `${tool} must display the authorized products`);
  }
  assert.deepEqual(calls, [["similar", { productId: "p1" }], ["compare", { productId: "p1", includeSimilar: true }], ["deals"]]);
});

test("wishlist sharing formats only the authenticated owner's current public product data and makes no write", async () => {
  let reads = 0;
  const result = await executeStorefrontUiAction({ getWishlist: async () => { reads++; return { items: [{ id: "p1", name: "Protetor", price: 9990, inStock: true }], message: "Lista" }; } } as any,
    { tool: "get_wishlist", args: { share: true } }, "merchant", "cart");
  assert.equal(reads, 1); assert.match(result.message, /encaminhe esta mensagem/);
  assert.match(result.message, /Protetor.*99,90/); assert.doesNotMatch(result.message, /https?:|ownerKey|buyerId/);
});

for (const [tool, handler, payload, expected] of [
  ["get_daily_deals", "getDailyDeals", { deals: [] }, /não há ofertas ativas/],
  ["get_reviews", "getReviews", { reviews: [], totalCount: 0, averageRating: 0 }, /não tem avaliações publicadas/],
  ["search_products", "searchProducts", { products: [] }, /Não encontrei produtos/],
  ["get_similar_products", "getSimilarProducts", { products: [] }, /Não encontrei produtos semelhantes/],
  ["compare_products", "compareProducts", { comparison: [{ id: "p1", name: "Atual", price: 100, attributes: {} }], requiresProductNames: true }, /Qual outro produto/],
  ["get_wishlist", "getWishlist", { items: [], message: "Nenhum item." }, /lista de desejos está vazia/],
  ["list_categories", "listCategories", { categories: [] }, /não cadastrou categorias/],
] as const) test(`${tool} explains an empty or insufficient result without an empty actionable block`, async () => {
  let calls = 0;
  const handlers = { [handler]: async () => { calls++; return payload; } } as any;
  const result = await executeStorefrontUiAction(handlers, { tool, args: ["get_reviews", "get_similar_products", "compare_products"].includes(tool) ? { productId: "p1" } : {} }, "merchant", "cart");
  assert.equal(calls, 1);
  assert.match(result.message, expected);
  assert.deepEqual(result.blocks, []);
});
