import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const CREATE_CHECKOUT_SESSION: ToolDefinition = {
  name: "create_checkout_session",
  description: "Hand off cart to checkout widget. Returns checkout URL and session ID for payment flow.",
  parameters: {
    type: "object",
    properties: {
      cartId: {
        type: "string",
        description: "Cart ID to checkout"
      }
    },
    required: ["cartId"]
  }
};

export function createCreateCheckoutSessionTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("create_checkout_session", (args) =>
    ctx.handlers.createCheckoutSession(args)
  );
}
