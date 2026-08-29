import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const GET_PRODUCT_AVAILABILITY: ToolDefinition = {
  name: "get_product_availability",
  description:
    "Check real-time stock for a specific variant. Returns inStock flag, quantity, and estimated shipping days.",
  parameters: {
    type: "object",
    properties: {
      variantId: {
        type: "string",
        description: "Product variant ID"
      }
    },
    required: ["variantId"]
  }
};

export function createGetProductAvailabilityTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("get_product_availability", (args) =>
    ctx.handlers.getProductAvailability(args)
  );
}
