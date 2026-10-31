import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const UPDATE_CART_ITEM: ToolDefinition = {
  name: "update_cart_item",
  description: "Set an absolute final quantity explicitly requested by the buyer, after get_cart identifies the exact line/selection. Returns updated cart. An existing item alone does not authorize UPDATE. For 'Adicione mais uma unidade do Núcleo Sérum de Barreira que já está no meu carrinho.' use add_item_to_cart with quantity=1: that is an increment, not an absolute final quantity. Never calculate a final quantity to bypass the buyer's ADD command; a past statement, negative, revoked or ambiguous request grants no write.",
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
        description: "Absolute final quantity explicitly requested (0 to 99; 0 removes that exact line). Not an increment: 'add one more' belongs to add_item_to_cart quantity 1, not current quantity + 1 here."
      }
    },
    required: ["cartId", "variantId", "quantity"]
  }
};

export function createUpdateCartItemTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("update_cart_item", (args) => ctx.handlers.updateCartItem(args));
}
