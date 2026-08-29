import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const LIST_PROMOTIONS: ToolDefinition = {
  name: "list_promotions",
  description:
    "List active promotions and coupons available for this merchant. Returns available discount codes, minimum cart value requirements, and expiration.",
  parameters: {
    type: "object",
    properties: {
      cartId: {
        type: "string",
        description: "Cart ID (to check eligibility)"
      }
    },
    required: ["cartId"]
  }
};

export function createListPromotionsTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("list_promotions", (args) => ctx.handlers.listPromotions(args));
}
