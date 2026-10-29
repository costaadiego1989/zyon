import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const ADD_TO_WISHLIST: ToolDefinition = {
  name: "add_to_wishlist",
  description:
    "Add a product to the buyer's wishlist. Returns updated wishlist with items.",
  parameters: {
    type: "object",
    properties: {
      productId: {
        type: "string",
        description: "Product ID to add to wishlist"
      }
    },
    required: ["productId"]
  }
};

export function createAddToWishlistTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("add_to_wishlist", (args) => ctx.handlers.addToWishlist(args));
}
