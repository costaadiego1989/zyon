import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const GET_PRODUCT_QUESTIONS: ToolDefinition = {
  name: "get_product_questions",
  description:
    "Read public answered FAQs, or use filter mine to retrieve only recent product questions linked to the authenticated buyer's account and support protocols. This personal history excludes legacy unlinked records; support replies are not individually linked to questions. Unanswered is unsupported. Never present public FAQs or a generic support reply as the buyer's own question/answer.",
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
