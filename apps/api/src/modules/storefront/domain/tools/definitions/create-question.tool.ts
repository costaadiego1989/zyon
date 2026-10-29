import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const CREATE_QUESTION: ToolDefinition = {
  name: "create_question",
  description:
    "Ask a question about a product on behalf of a buyer. Requires question text and authorName. Returns the created question awaiting an answer.",
  parameters: {
    type: "object",
    properties: {
      productId: {
        type: "string",
        description: "Product ID being asked about"
      },
      question: {
        type: "string",
        description: "Question text"
      },
      authorName: {
        type: "string",
        description: "Display name of the asker"
      }
    },
    required: ["productId", "question", "authorName"]
  }
};

export function createCreateQuestionTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("create_question", (args) => ctx.handlers.createQuestion(args));
}
