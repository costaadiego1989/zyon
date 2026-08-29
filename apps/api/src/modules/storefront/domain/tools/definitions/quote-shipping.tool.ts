import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const QUOTE_SHIPPING: ToolDefinition = {
  name: "quote_shipping",
  description:
    "Get shipping quote. Can quote for a cart OR for a single product (by productId). Returns carriers (Sedex, PAC), price in cents, and delivery days. Does NOT require product to be in cart.",
  parameters: {
    type: "object",
    properties: {
      cartId: {
        type: "string",
        description: "Cart ID (optional — use when quoting for whole cart)"
      },
      productId: {
        type: "string",
        description: "Product ID (optional — use when quoting shipping for a specific product without cart)"
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
