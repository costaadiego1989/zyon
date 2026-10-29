import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const REMOVE_COUPON: ToolDefinition = {
  name: "remove_coupon",
  description: "Remove an applied coupon from the cart. Returns updated cart without discount.",
  parameters: {
    type: "object",
    properties: {
      cartId: {
        type: "string",
        description: "Cart ID"
      }
    },
    required: ["cartId"]
  }
};

export function createRemoveCouponTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("remove_coupon", (args) => ctx.handlers.removeCoupon(args));
}
