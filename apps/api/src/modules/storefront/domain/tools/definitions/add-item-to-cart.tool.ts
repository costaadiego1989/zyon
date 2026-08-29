import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const ADD_ITEM_TO_CART: ToolDefinition = {
  name: "add_item_to_cart",
  description:
    "Add product to cart. Accepts either a product ID or a variant ID — the system resolves the correct variant automatically. Creates new cart if cartId omitted. Returns updated cart with items, total, and cartId. ALWAYS call this when user wants to add something to cart.",
  parameters: {
    type: "object",
    properties: {
      cartId: {
        type: "string",
        description: "Existing cart ID (optional; omit to use session cart)"
      },
      variantId: {
        type: "string",
        description: "Product ID or variant ID from search_products results. Use the product 'id' field directly — the system resolves the variant."
      },
      quantity: {
        type: "number",
        description: "Quantity to add (min: 1, default: 1)"
      }
    },
    required: ["variantId", "quantity"]
  }
};

export function createAddItemToCartTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("add_item_to_cart", (args) => ctx.handlers.addItemToCart(args));
}
