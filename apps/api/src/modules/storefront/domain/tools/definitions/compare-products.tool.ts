import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const COMPARE_PRODUCTS: ToolDefinition = {
  name: "compare_products",
  description:
    "Compare multiple products side-by-side. Returns table with id, name, attributes, price, stock, and rating.",
  parameters: {
    type: "object",
    properties: {
      productIds: {
        type: "array",
        items: { type: "string" },
        description: "Array of product IDs (max 5)"
      }
    },
    required: ["productIds"]
  }
};

export function createCompareProductsTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("compare_products", (args) => ctx.handlers.compareProducts(args));
}
