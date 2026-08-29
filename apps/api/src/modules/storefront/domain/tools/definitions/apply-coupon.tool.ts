import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const APPLY_COUPON: ToolDefinition = {
  name: "apply_coupon",
  description:
    "Apply coupon code to cart. Returns whether applied, discount amount, new total, and reason if failed.",
  parameters: {
    type: "object",
    properties: {
      cartId: {
        type: "string",
        description: "Cart ID"
      },
      couponCode: {
        type: "string",
        description: "Coupon code (uppercase)"
      }
    },
    required: ["cartId", "couponCode"]
  }
};

export function createApplyCouponTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("apply_coupon", (args) => ctx.handlers.applyCoupon(args));
}
