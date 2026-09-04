import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const ADD_ITEM_TO_CART: ToolDefinition = {
  name: "add_item_to_cart",
  description:
    "Add product to cart. Accepts either a product ID or a variant ID — the system resolves the correct variant automatically. Creates new cart if cartId omitted. Returns updated cart with items, total, and cartId. ALWAYS call this when user wants to add something to cart. If the message contains a tag like [variantId:xxx], pass xxx as variantId. If it contains [optionItemIds:a,b,c], pass those ids (split on comma) as selectedOptionItemIds — these are the buyer's chosen food options; the server validates and prices them. If it contains [crossSellPromoId:xxx], pass xxx as crossSellPromoId — this signals the buyer accepted a cross-sell suggestion; the server applies the authorized discount (you must NEVER compute or promise the discount yourself).",
  parameters: {
    type: "object",
    properties: {
      cartId: {
        type: "string",
        description: "Existing cart ID (optional; omit to use session cart)"
      },
      variantId: {
        type: "string",
        description: "Product ID or variant ID from search_products results. Use the product 'id' field directly — the system resolves the variant. If the message has a [variantId:xxx] tag, use xxx."
      },
      quantity: {
        type: "number",
        description: "Quantity to add (min: 1, default: 1)"
      },
      selectedOptionItemIds: {
        type: "array",
        items: { type: "string" },
        description: "Food option item ids the buyer chose (size, add-ons). Extract from a [optionItemIds:a,b,c] tag in the message. Omit when there are none."
      },
      crossSellPromoId: {
        type: "string",
        description: "Cross-sell promotion id when the buyer accepted a cross-sell suggestion. Extract from a [crossSellPromoId:xxx] tag in the message. Omit when there is none. The server validates the sku against the promo and applies the authorized discount — never compute a discount yourself."
      }
    },
    required: ["variantId", "quantity"]
  }
};

export function createAddItemToCartTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("add_item_to_cart", (args) => ctx.handlers.addItemToCart(args));
}
