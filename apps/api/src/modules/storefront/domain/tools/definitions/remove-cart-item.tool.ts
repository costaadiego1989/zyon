import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const REMOVE_CART_ITEM: ToolDefinition = {
  name: "remove_cart_item",
  description: "Remove product variant from cart. Returns updated cart.",
  parameters: {
    type: "object",
    properties: {
      cartId: {
        type: "string",
        description: "Cart ID"
      },
      variantId: {
        type: "string",
        description: "Product variant ID to remove"
      }
    },
    required: ["cartId", "variantId"]
  }
};

export function createRemoveCartItemTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("remove_cart_item", (args) => ctx.handlers.removeCartItem(args));
}
