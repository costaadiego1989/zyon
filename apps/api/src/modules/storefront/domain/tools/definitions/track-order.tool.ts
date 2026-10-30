import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const TRACK_ORDER: ToolDefinition = {
  name: "track_order",
  description:
    "Track order status and shipping. Returns order status, tracking code, carrier, and estimated delivery date. Use when buyer asks about delivery progress. Omit orderId when the buyer has not identified an order: the handler asks for its number without looking up or choosing an order.",
  parameters: {
    type: "object",
    properties: {
      orderId: {
        type: "string",
        description: "Order ID supplied by the buyer to track; omit when unknown"
      }
    }
  }
};

export function createTrackOrderTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("track_order", (args) => ctx.handlers.trackOrder(args));
}
