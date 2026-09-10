import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const GET_INVOICE: ToolDefinition = {
  name: "get_invoice",
  description:
    "Check whether a fiscal invoice is available for an order. Never invent a fiscal document, URL, number, or issue date.",
  parameters: {
    type: "object",
    properties: {
      orderId: {
        type: "string",
        description: "Order ID to fetch invoice for"
      }
    },
    required: ["orderId"]
  }
};

export function createGetInvoiceTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("get_invoice", (args) => ctx.handlers.getInvoice(args));
}
