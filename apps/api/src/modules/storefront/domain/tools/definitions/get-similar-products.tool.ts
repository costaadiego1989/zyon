import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const GET_SIMILAR_PRODUCTS: ToolDefinition = {
  name: "get_similar_products",
  description:
    "Get similar or related products for a given product. Returns products in the same shape as search_products (id, name, price, image, stock). Use when buyer wants alternatives or comparisons.",
  parameters: {
    type: "object",
    properties: {
      productId: {
        type: "string",
        description: "Product ID to find similar items for"
      },
      limit: {
        type: "number",
        description: "Max results (default: 5, max: 20)"
      }
    },
    required: ["productId"]
  }
};

export function createGetSimilarProductsTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("get_similar_products", (args) => ctx.handlers.getSimilarProducts(args));
}
