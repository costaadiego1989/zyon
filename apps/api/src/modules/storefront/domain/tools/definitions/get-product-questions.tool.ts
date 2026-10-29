import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const GET_PRODUCT_QUESTIONS: ToolDefinition = {
  name: "get_product_questions",
  description:
    "Get Q&A for a product. Returns questions with id, question text, answer (if any), author, and date. Use when buyer asks about product details not in the description.",
  parameters: {
    type: "object",
    properties: {
      productId: {
        type: "string",
        description: "Product ID to fetch questions for"
      },
      filter: {
        type: "string",
        enum: ["answered", "unanswered", "mine"],
        description:
          "Filter questions: answered (has reply), unanswered (no reply yet), mine (asked by current buyer). Optional."
      }
    },
    required: ["productId"]
  }
};

export function createGetProductQuestionsTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("get_product_questions", (args) =>
    ctx.handlers.getProductQuestions(args)
  );
}
