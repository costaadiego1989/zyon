import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const LIST_PROMOTIONS: ToolDefinition = {
  name: "list_promotions",
  description:
    "List the active coupons, progressive discounts and advanced cart rules available for this merchant. Use whenever the buyer asks about coupons, discounts, promo codes or 'what deals do you have'. Works with or without a cart — cartId is optional and only used to check eligibility against the current cart total.",
  parameters: {
    type: "object",
    properties: {
      cartId: {
        type: "string",
        description: "Optional cart ID, to check eligibility against the current cart total"
      }
    },
    required: []
  }
};

export function createListPromotionsTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("list_promotions", (args) => ctx.handlers.listPromotions(args));
}
