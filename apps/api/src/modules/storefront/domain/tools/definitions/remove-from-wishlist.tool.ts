import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const REMOVE_FROM_WISHLIST: ToolDefinition = {
  name: "remove_from_wishlist",
  description:
    "Remove a product from the buyer's wishlist. Returns updated wishlist.",
  parameters: {
    type: "object",
    properties: {
      productId: {
        type: "string",
        description: "Product ID to remove from wishlist"
      }
    },
    required: ["productId"]
  }
};

export function createRemoveFromWishlistTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("remove_from_wishlist", (args) =>
    ctx.handlers.removeFromWishlist(args)
  );
}
