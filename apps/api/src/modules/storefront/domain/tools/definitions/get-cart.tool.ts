import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const GET_CART: ToolDefinition = {
  name: "get_cart",
  description: "Retrieve the current authenticated cart: items, total, item count and discounts. Omit cartId; the server owns the current session and resolves its cart. Never infer an ID from product names or previous messages.",
  parameters: {
    type: "object",
    properties: {
      cartId: {
        type: "string",
        description: "Optional current server-bound cart reference; omit unless supplied by the current request."
      }
    },
    required: []
  }
};

export function createGetCartTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("get_cart", () => ctx.handlers.getCart({ cartId: ctx.sessionId }), { cartId: ctx.sessionId });
}
