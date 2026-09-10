import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const CANCEL_ORDER: ToolDefinition = {
  name: "cancel_order",
  description:
    "Request order cancellation only through an authorized persisted workflow. If that workflow is unavailable, return explicit unavailability without claiming cancellation or refund.",
  parameters: {
    type: "object",
    properties: {
      orderId: {
        type: "string",
        description: "Order ID to cancel"
      },
      reason: {
        type: "string",
        description: "Optional reason for cancellation"
      }
    },
    required: ["orderId"]
  }
};

export function createCancelOrderTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("cancel_order", (args) => ctx.handlers.cancelOrder(args));
}
