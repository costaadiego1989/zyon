import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const APPLY_COUPON: ToolDefinition = {
  name: "apply_coupon",
  description:
    "Apply a coupon code to the cart. Returns whether applied, discount amount, new total, and reason if failed. ALWAYS call this when the user wants to apply/use a coupon — including messages like 'Aplicar cupom XPTO', 'usar cupom XPTO', 'tenho o cupom XPTO', or any message containing a coupon code to apply. Extract the code (uppercase) as couponCode.",
  parameters: {
    type: "object",
    properties: {
      cartId: {
        type: "string",
        description: "Cart ID (optional; omit to use the session cart)"
      },
      couponCode: {
        type: "string",
        description: "Coupon code in uppercase. From a message like 'Aplicar cupom WELCOME10', use WELCOME10."
      }
    },
    required: ["couponCode"]
  }
};

export function createApplyCouponTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("apply_coupon", (args) => ctx.handlers.applyCoupon(args));
}
