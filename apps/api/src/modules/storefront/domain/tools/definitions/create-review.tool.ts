import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const CREATE_REVIEW: ToolDefinition = {
  name: "create_review",
  description:
    "Submit a product review on behalf of a buyer. Requires rating (1-5), text, authorName, and authorPhone. The buyer must provide their phone for identification. Returns the created review with id and date.",
  parameters: {
    type: "object",
    properties: {
      productId: {
        type: "string",
        description: "Product ID being reviewed"
      },
      rating: {
        type: "number",
        description: "Rating from 1 (worst) to 5 (best)"
      },
      text: {
        type: "string",
        description: "Review text content"
      },
      authorName: {
        type: "string",
        description: "Display name of the reviewer"
      },
      authorPhone: {
        type: "string",
        description: "Phone number of the reviewer (Brazilian format with DDD, e.g. 11999999999). Required for buyer identification."
      }
    },
    required: ["productId", "rating", "text", "authorName", "authorPhone"]
  }
};

export function createCreateReviewTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("create_review", (args) => ctx.handlers.createReview(args));
}
