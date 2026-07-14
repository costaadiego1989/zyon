/**
 * Chat tools — LangChain-style tool definitions for the LangGraph agent.
 *
 * Each tool defines:
 *   - name (snake_case)
 *   - description (for the LLM to understand when to invoke)
 *   - parameters (JSON schema)
 *   - execute(args) — async handler returning ToolResult
 *
 * Tools are executed server-side; the LLM only decides which to call and with
 * what args. Critical invariant: apply_discount NEVER directly authorizes — it
 * only relays the rules-engine verdict.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string; data?: unknown };

export interface ExecutableTool {
  name: string;
  execute: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ToolHandlers {
  searchCatalog: (args: { query: string }) => Promise<unknown>;
  checkShipping: (args: { zip: string }) => Promise<unknown>;
  checkInventory: (args: { sku: string }) => Promise<unknown>;
  getBuyerHistory: (args?: Record<string, unknown>) => Promise<unknown>;
  applyDiscount: (args: { discount_percent: number }) => Promise<unknown>;
}

export interface ToolContext {
  merchantId: string;
  sessionId: string;
  handlers: ToolHandlers;
}

// ─── Tool definitions ─────────────────────────────────────────────────────

const SEARCH_CATALOG: ToolDefinition = {
  name: "search_catalog",
  description: "Search the merchant's product catalog. Returns a list of matching products with SKU, name, and price.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Product search query" }
    },
    required: ["query"]
  }
};

const CHECK_SHIPPING: ToolDefinition = {
  name: "check_shipping",
  description: "Quote shipping cost and delivery time for a given ZIP/CEP. Returns available carriers, prices, and days.",
  parameters: {
    type: "object",
    properties: {
      zip: { type: "string", description: "8-digit Brazilian CEP or ZIP code" }
    },
    required: ["zip"]
  }
};

const CHECK_INVENTORY: ToolDefinition = {
  name: "check_inventory",
  description: "Check if a product SKU is in stock and how many units are available.",
  parameters: {
    type: "object",
    properties: {
      sku: { type: "string", description: "Product SKU to check" }
    },
    required: ["sku"]
  }
};

const GET_BUYER_HISTORY: ToolDefinition = {
  name: "get_buyer_history",
  description: "Retrieve the buyer's purchase history (order count, lifetime value) for personalization. No arguments needed.",
  parameters: {
    type: "object",
    properties: {}
  }
};

const APPLY_DISCOUNT: ToolDefinition = {
  name: "apply_discount",
  description: "Request a discount through the rules-engine. The LLM DOES NOT authorize the discount — it only proposes. The rules-engine approves or denies.",
  parameters: {
    type: "object",
    properties: {
      discount_percent: {
        type: "number",
        description: "Proposed discount percentage (will be validated by rules-engine)"
      }
    },
    required: ["discount_percent"]
  }
};

export function buildChatTools(): ToolDefinition[] {
  return [
    SEARCH_CATALOG,
    CHECK_SHIPPING,
    CHECK_INVENTORY,
    GET_BUYER_HISTORY,
    APPLY_DISCOUNT
  ];
}

// ─── Executable tools ─────────────────────────────────────────────────────

function wrapHandler(
  name: string,
  fn: (args: any) => Promise<unknown>
): ExecutableTool {
  return {
    name,
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
      try {
        const data = await fn(args as any);
        return { ok: true, data };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message };
      }
    }
  };
}

export function createSearchCatalogTool(ctx: ToolContext): ExecutableTool {
  return wrapHandler("search_catalog", (args) => ctx.handlers.searchCatalog(args));
}

export function createCheckShippingTool(ctx: ToolContext): ExecutableTool {
  return wrapHandler("check_shipping", (args) => ctx.handlers.checkShipping(args));
}

export function createCheckInventoryTool(ctx: ToolContext): ExecutableTool {
  return wrapHandler("check_inventory", (args) => ctx.handlers.checkInventory(args));
}

export function createGetBuyerHistoryTool(ctx: ToolContext): ExecutableTool {
  return wrapHandler("get_buyer_history", (args) => ctx.handlers.getBuyerHistory(args));
}

export function createApplyDiscountTool(ctx: ToolContext): ExecutableTool {
  return wrapHandler("apply_discount", (args) => ctx.handlers.applyDiscount(args));
}

export function buildExecutableTools(ctx: ToolContext): ExecutableTool[] {
  return [
    createSearchCatalogTool(ctx),
    createCheckShippingTool(ctx),
    createCheckInventoryTool(ctx),
    createGetBuyerHistoryTool(ctx),
    createApplyDiscountTool(ctx)
  ];
}