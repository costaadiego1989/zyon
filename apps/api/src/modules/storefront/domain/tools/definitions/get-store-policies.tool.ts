import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const GET_STORE_POLICIES: ToolDefinition = {
  name: "get_store_policies",
  description:
    "Read the current published store policies: privacy, terms, returns, exchanges, shipping, warranty, payment or general. May return text, an external document URL, or configured=false. Never invent missing conditions or infer document contents from a URL.",
  parameters: {
    type: "object",
    properties: {
      policyType: {
        type: "string",
        enum: ["privacy", "terms", "returns", "exchanges", "shipping", "warranty", "payment", "general", "all"],
        description:
          "Type of policy to retrieve. Use 'all' to get every policy in one call. Default: 'all'."
      }
    },
    required: []
  }
};

export function createGetStorePoliciesTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("get_store_policies", (args) => ctx.handlers.getStorePolicies(args));
}
