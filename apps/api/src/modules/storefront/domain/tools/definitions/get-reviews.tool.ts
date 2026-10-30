import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const GET_REVIEWS: ToolDefinition = {
  name: "get_reviews",
  description:
    "Read public, approved product reviews and testimonials. Use for opinions, ratings, feedback and positive/negative/recent review filters; always call get_reviews before reporting counts, average, comments or absence. Returns the filtered count, filtered average and a source-aware cursor. Never treat a storage error as no reviews and never fabricate a customer experience.",
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
        description: "Max reviews to return (default: 10, effective max: 20)"
      },
      cursor: {
        type: "string",
        description: "Use only nextCursor from the preceding result, preserving productId and filter. Omit to start a new filter."
      }
    },
    required: ["productId"]
  }
};

export function createGetReviewsTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("get_reviews", (args) => ctx.handlers.getReviews(args));
}
