import test from "node:test";
import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { executeStorefrontUiAction } from "./storefront-ui-action.executor.js";

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
