import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const UPDATE_CART_ITEM: ToolDefinition = {
  name: "update_cart_item",
  description: "Update quantity of an item already in the cart. Returns updated cart.",
  parameters: {
    type: "object",
    properties: {
      cartId: {
        type: "string",
        description: "Cart ID"
      },
      variantId: {
        type: "string",
        description: "Product variant ID to update"
      },
      quantity: {
        type: "number",
        description: "New quantity (min: 1, max: 99)"
      }
    },
    required: ["cartId", "variantId", "quantity"]
  }
};

export function createUpdateCartItemTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("update_cart_item", (args) => ctx.handlers.updateCartItem(args));
}
