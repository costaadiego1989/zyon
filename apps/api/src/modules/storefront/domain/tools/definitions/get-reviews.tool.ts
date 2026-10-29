import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const GET_REVIEWS: ToolDefinition = {
  name: "get_reviews",
  description:
    "Get product reviews. Returns array of reviews with id, author, rating (1-5), text, and date. Use when buyer asks about opinions, ratings, or feedback on a product.",
  parameters: {
    type: "object",
    properties: {
      productId: {
        type: "string",
        description: "Product ID to fetch reviews for"
      },
      filter: {
        type: "string",
        enum: ["positive", "negative", "recent"],
        description:
          "Filter reviews: positive (4-5 stars), negative (1-2 stars), recent (latest first). Optional."
      },
      limit: {
        type: "number",
        description: "Max reviews to return (default: 10, max: 50)"
      }
    },
    required: ["productId"]
  }
};

export function createGetReviewsTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("get_reviews", (args) => ctx.handlers.getReviews(args));
}
