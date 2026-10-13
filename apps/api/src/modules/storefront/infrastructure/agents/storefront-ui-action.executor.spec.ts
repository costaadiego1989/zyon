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
    const result = await executeStorefrontUiAction(handlers, { tool, args: { productId: "p1" } }, "merchant", "cart");
    assert.ok(result.blocks.length, `${tool} must display the authorized products`);
  }
  assert.deepEqual(calls, [["similar", { productId: "p1" }], ["compare", { productId: "p1", includeSimilar: true }], ["deals"]]);
});
