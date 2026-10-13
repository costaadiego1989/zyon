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
