import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";
import { readShoppingProducts } from "../read-shopping-products.js";

export const SEARCH_PRODUCTS: ToolDefinition = {
  name: "search_products",
  description:
    "Read-only search of this merchant's canonical catalog. For shopping discovery include criteria version 1: query contains ONLY product/name/purpose or '*'; put price interval (integer cents), minimum rating, structured variant attributes (required vs preferred), delivery requirements and unsupported criteria in separate fields. For an auxiliary lookup before review, questions, comparison or details, pass ONLY the product name as query, then continue the requested action using the canonical ID; review rating, author and comment are not search criteria. Do not put filter instructions or 'do not change my cart' in the query. Never omit a buyer shopping requirement or claim unsupported delivery/sales/discount filters were verified. Returns product IDs (NOT variant IDs); only an explicit buyer action can add a returned variant to cart.",
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
  return wrapHandler("search_products", (args) => readShoppingProducts(ctx.handlers, args));
}
