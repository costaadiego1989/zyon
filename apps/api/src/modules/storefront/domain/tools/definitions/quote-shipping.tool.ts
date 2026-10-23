import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const QUOTE_SHIPPING: ToolDefinition = {
  name: "quote_shipping",
  description:
    "Read a current shipping reference for the authenticated cart and destination CEP. Returns only configured manual tariffs or real merchant-connected carriers, prices in cents and estimated days. This is NOT selected shipping or a financial/free-shipping grant. Missing address/dimensions/account or ambiguous product choices return a prerequisite, never fabricated PAC/Sedex. For product-only requests, guide the existing product detail/variant selection.",
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
