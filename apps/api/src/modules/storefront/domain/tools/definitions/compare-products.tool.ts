import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const COMPARE_PRODUCTS: ToolDefinition = {
  name: "compare_products",
  description:
    "Compare named products or a current product with same-category alternatives. Returns confirmed products only.",
  parameters: {
    type: "object",
    properties: {
      productIds: {
        type: "array",
        items: { type: "string" },
        description: "Array of product IDs (max 5)"
      },
      productId: { type: "string", description: "Current product ID when comparing its similar products" },
      productNames: { type: "array", items: { type: "string" }, description: "Exact product names when IDs are unavailable" },
      productName: { type: "string", description: "Current product name when its ID is unavailable" },
      includeSimilar: { type: "boolean", description: "When one product is supplied, include same-category alternatives" },
    },
  }
};

export function createCompareProductsTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("compare_products", (args) => ctx.handlers.compareProducts(args));
}
