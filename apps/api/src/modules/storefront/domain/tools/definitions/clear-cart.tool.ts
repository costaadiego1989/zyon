import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const CLEAR_CART: ToolDefinition = {
  name: "clear_cart",
  description: "Remove all items from the cart. Returns empty cart.",
  parameters: {
    type: "object",
    properties: {
      cartId: {
        type: "string",
        description: "Cart ID"
      }
    },
    required: ["cartId"]
  }
};

export function createClearCartTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("clear_cart", (args) => ctx.handlers.clearCart(args));
}
