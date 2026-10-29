import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const SEARCH_PRODUCTS: ToolDefinition = {
  name: "search_products",
  description:
    "Search the merchant's product catalog. Use empty query or '*' to list all/featured products. Use categoryId to filter by category. Returns matching products with 'id' (use this ID for add_item_to_cart variantId), name, price, image, variants, and stock status.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Product search query (brand, category, product name, or '*' for all products)"
      },
      categoryId: {
        type: "string",
        description: "Filter by category ID (use this when user wants products from a specific category)"
      },
      maxPrice: {
        type: "number",
        description: "Maximum price in cents (optional)"
      },
      inStockOnly: {
        type: "boolean",
        description: "Return only in-stock products (default: false)"
      },
      limit: {
        type: "number",
        description: "Max results (default: 10, max: 20)"
      },
      sortBy: {
        type: "string",
        enum: ["price_asc", "price_desc", "rating", "best_sellers", "newest", "discount"],
        description:
          "Sort order: price_asc (cheapest first), price_desc (most expensive first), rating (highest rated), best_sellers (most sold), newest (latest added), discount (biggest discount first)"
      }
    },
    required: ["query"]
  }
};

export function createSearchProductsTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("search_products", (args) => ctx.handlers.searchProducts(args));
}
