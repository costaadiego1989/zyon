import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const GET_PRODUCT_DETAILS: ToolDefinition = {
  name: "get_product_details",
  description:
    "Get complete product details: description, variants, media, reviews, rating, and stock for each variant.",
  parameters: {
    type: "object",
    properties: {
      productId: {
        type: "string",
        description: "Product ID"
      }
    },
    required: ["productId"]
  }
};

export function createGetProductDetailsTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("get_product_details", (args) => ctx.handlers.getProductDetails(args));
}
