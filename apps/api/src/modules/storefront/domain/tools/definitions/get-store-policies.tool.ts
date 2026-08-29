import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const GET_STORE_POLICIES: ToolDefinition = {
  name: "get_store_policies",
  description:
    "Get store policies: returns, exchanges, shipping, or warranty. Returns policy text. Use when buyer asks about return windows, exchange rules, shipping terms, or warranty coverage.",
  parameters: {
    type: "object",
    properties: {
      policyType: {
        type: "string",
        enum: ["returns", "exchanges", "shipping", "warranty", "all"],
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
