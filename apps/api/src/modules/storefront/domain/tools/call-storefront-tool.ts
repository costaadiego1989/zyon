import { storefrontToolSchema } from "../contracts/storefront-tool.schemas.js";
import { validateStorefrontToolOutput } from "../contracts/storefront-tool-output.schemas.js";
import type { ToolResult } from "./types.js";

/** Single-call contract boundary for native tools and direct consumers.
 * Exceptions propagate: a caller must not turn an uncertain write into a retry.
 */
export async function callStorefrontTool(
  name: string,
  args: Record<string, unknown>,
  execute: (validatedArgs: Record<string, unknown>) => Promise<unknown>,
  scope?: { cartId: string },
): Promise<ToolResult> {
  const parsed = storefrontToolSchema(name)?.safeParse(args);
  if (!parsed?.success) return { ok: false, error: "invalid_tool_arguments", code: "invalid_tool_arguments" };
  if (scope && parsed.data.cartId !== undefined && parsed.data.cartId !== scope.cartId)
    return { ok: false, error: "invalid_tool_arguments", code: "invalid_tool_arguments" };
  return validateStorefrontToolOutput(name, await execute(parsed.data), scope);
}

