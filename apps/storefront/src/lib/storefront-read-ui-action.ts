import type { StorefrontReadUiAction, StorefrontReadUiActionCapability, StorefrontReadUiActionRequest } from "@zyon/shared-types";

type CapabilityScope = { merchantId: string; capability: StorefrontReadUiActionCapability };
// Protocol hints only, scoped to this tab and conversation. Signed access and
// every server-side merchant/ownership/quota check remain authoritative.
const capabilities = new Map<string, CapabilityScope>();

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
const identifier = (value: unknown): value is string => typeof value === "string" && value.length <= 191 && value.trim().length > 0;

export function isStorefrontReadUiAction(value: unknown): value is StorefrontReadUiAction {
  if (!record(value) || !keys(value, ["tool", "args"]) || !record(value.args)) return false;
  const args = value.args;
  if (value.tool === "get_product_details") return keys(args, ["productId"]) && identifier(args.productId);
  return value.tool === "search_products" && keys(args, ["query", "categoryId", "cursor"])
    && args.query === "*" && identifier(args.categoryId)
    && (args.cursor === undefined || typeof args.cursor === "string" && args.cursor.length <= 2048);
}

export function assertStorefrontReadUiAction(value: unknown): asserts value is StorefrontReadUiAction {
  if (!isStorefrontReadUiAction(value)) throw new Error("invalid_storefront_ui_action");
}

/** Snapshot intent before an asynchronous access renewal can yield control. */
export function cloneStorefrontReadUiAction(value: unknown): StorefrontReadUiAction {
  assertStorefrontReadUiAction(value);
  if (value.tool === "get_product_details") {
    return { tool: "get_product_details", args: { productId: value.args.productId } };
  }
  return { tool: "search_products", args: { query: "*", categoryId: value.args.categoryId,
    ...(value.args.cursor === undefined ? {} : { cursor: value.args.cursor }) } };
}

function parseCapability(value: unknown): StorefrontReadUiActionCapability | null {
  if (!record(value) || !keys(value, ["version", "tools"]) || value.version !== 1 || !Array.isArray(value.tools)) return null;
  if (!value.tools.length || value.tools.length > 2 || new Set(value.tools).size !== value.tools.length
    || !value.tools.every(tool => tool === "search_products" || tool === "get_product_details")) return null;
  return { version: 1, tools: [...value.tools] };
}

export function forgetStorefrontReadUiActionCapability(conversationId: string): void {
  capabilities.delete(conversationId);
}

/** Call only after a successful start/renewal with a validated conversation ID. */
export function rememberStorefrontReadUiActionCapability(conversationId: string, merchantId: unknown, value: unknown): void {
  capabilities.delete(conversationId);
  const capability = parseCapability(value);
  if (identifier(conversationId) && identifier(merchantId) && capability) capabilities.set(conversationId, { merchantId, capability });
}

export function storefrontReadUiActionRequest(conversationId: string, merchantId: string | undefined, action: unknown): StorefrontReadUiActionRequest | undefined {
  assertStorefrontReadUiAction(action);
  const scope = capabilities.get(conversationId);
  if (!scope || scope.merchantId !== merchantId || !scope.capability.tools.includes(action.tool)) return undefined;
  return { ui_action_version: 1, ui_action: action };
}
