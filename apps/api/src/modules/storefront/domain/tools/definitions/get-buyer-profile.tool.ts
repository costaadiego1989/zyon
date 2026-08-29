import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const GET_BUYER_PROFILE: ToolDefinition = {
  name: "get_buyer_profile",
  description:
    "Get the logged-in buyer's profile: name, email, saved addresses, and order count. Use to personalize responses or pre-fill checkout.",
  parameters: {
    type: "object",
    properties: {},
    required: []
  }
};

export function createGetBuyerProfileTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("get_buyer_profile", () => ctx.handlers.getBuyerProfile());
}
