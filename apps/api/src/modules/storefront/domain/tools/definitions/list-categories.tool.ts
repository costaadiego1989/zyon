import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const LIST_CATEGORIES: ToolDefinition = {
  name: "list_categories",
  description:
    "List all product categories for this store. Returns category names and IDs for browsing by section.",
  parameters: {
    type: "object",
    properties: {},
    required: []
  }
};

export function createListCategoriesTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("list_categories", () => ctx.handlers.listCategories());
}
