import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const QUOTE_SHIPPING: ToolDefinition = {
  name: "quote_shipping",
  description:
    "Read a current shipping reference for the authenticated existing cart and destination CEP. Use zipCode only; the server owns the cart, selected variants and quantities. Returns configured local delivery or real merchant-connected carrier prices in cents. This is NOT selected shipping or a free-shipping grant. Missing cart, address, dimensions or account returns a prerequisite, never fabricated PAC/Sedex. Ask the buyer to choose variants and explicitly add them when the cart is missing or empty; never create a cart just to quote.",
  parameters: {
    type: "object",
    properties: {
      cartId: {
        type: "string",
        description: "Optional current authenticated cart ID; omit to use the server-bound cart. Never use a product ID."
      },
      zipCode: {
        type: "string",
        description: "8-digit Brazilian CEP or ZIP code"
      }
    },
    required: ["zipCode"]
  }
};

export function createQuoteShippingTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("quote_shipping", (args) => ctx.handlers.quoteShipping(args));
}
