import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const GET_CART: ToolDefinition = {
  name: "get_cart",
  description: "Retrieve current cart state: items, total price, item count, and applied discounts.",
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

export function createGetCartTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("get_cart", (args) => ctx.handlers.getCart(args));
}
