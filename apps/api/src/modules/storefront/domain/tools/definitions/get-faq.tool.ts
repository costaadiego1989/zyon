import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const GET_FAQ: ToolDefinition = {
  name: "get_faq",
  description:
    "Get frequently asked questions for the store. Optionally filter by category (e.g. 'payment', 'shipping', 'account'). Returns FAQ items with question and answer.",
  parameters: {
    type: "object",
    properties: {
      category: {
        type: "string",
        description: "Filter by FAQ category (optional)"
      }
    },
    required: []
  }
};

export function createGetFaqTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("get_faq", (args) => ctx.handlers.getFaq(args));
}
