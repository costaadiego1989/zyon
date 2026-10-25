import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const GET_WISHLIST: ToolDefinition = {
  name: "get_wishlist",
  description:
    "Get the current buyer's wishlist. Returns array of saved products.",
  parameters: {
    type: "object",
    properties: {},
    required: []
  }
};

export function createGetWishlistTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("get_wishlist", () => ctx.handlers.getWishlist());
}
