import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const GET_DAILY_DEALS: ToolDefinition = {
  name: "get_daily_deals",
  description:
    "Get current daily or flash deals. Returns products with deal info including discount percent and expiration time. Use when buyer asks about promotions, deals, or limited-time offers.",
  parameters: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        description: "Max deals to return (default: 10, max: 30)"
      }
    },
    required: []
  }
};

export function createGetDailyDealsTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("get_daily_deals", (args) => ctx.handlers.getDailyDeals(args));
}
