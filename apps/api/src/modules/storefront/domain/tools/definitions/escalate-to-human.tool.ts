import type { ToolDefinition, ExecutableTool, StoreToolContext } from "../types.js";
import { wrapHandler } from "../types.js";

export const ESCALATE_TO_HUMAN: ToolDefinition = {
  name: "escalate_to_human",
  description:
    "Request escalation to a human support agent. Use when the buyer explicitly asks for human help, the issue is too complex, or the buyer is frustrated. Returns ticket/escalation confirmation.",
  parameters: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        description: "Reason for escalation (what the buyer needs help with)"
      }
    },
    required: ["reason"]
  }
};

export function createEscalateToHumanTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("escalate_to_human", (args) => ctx.handlers.escalateToHuman(args));
}
