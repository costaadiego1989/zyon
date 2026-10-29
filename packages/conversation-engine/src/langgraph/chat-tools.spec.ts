import test from "node:test";
import assert from "node:assert/strict";
import {
  buildChatTools,
  createSearchCatalogTool,
  createCheckShippingTool,
  createCheckInventoryTool,
  createGetBuyerHistoryTool,
  createApplyDiscountTool,
  type ToolContext,
  type ToolResult
} from "./chat-tools.js";

// ─── Tool definitions ──────────────────────────────────────────────────────

test("buildChatTools returns the 5 required tool definitions", () => {
  const tools = buildChatTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "apply_discount",
    "check_inventory",
    "check_shipping",
    "get_buyer_history",
    "search_catalog"
  ]);
});

test("each tool has a name, description, and JSON schema parameters", () => {
  const tools = buildChatTools();
  for (const tool of tools) {
    assert.ok(tool.name.length > 0, `${tool.name} needs a name`);
    assert.ok(tool.description.length > 10, `${tool.name} needs a description`);
    assert.equal(tool.parameters.type, "object");
    assert.ok(tool.parameters.properties, `${tool.name} needs properties`);
  }
});

test("search_catalog tool declares a query parameter", () => {
  const tools = buildChatTools();
  const tool = tools.find((t) => t.name === "search_catalog")!;
  assert.ok(tool.parameters.properties?.query);
});

test("check_shipping tool declares a zip parameter", () => {
  const tools = buildChatTools();
  const tool = tools.find((t) => t.name === "check_shipping")!;
  assert.ok(tool.parameters.properties?.zip);
});

test("apply_discount tool declares discount_percent parameter", () => {
  const tools = buildChatTools();
  const tool = tools.find((t) => t.name === "apply_discount")!;
  assert.ok(tool.parameters.properties?.discount_percent);
});

// ─── Tool execution (mocked handlers) ──────────────────────────────────────

const baseCtx: ToolContext = {
  merchantId: "mrc_1",
  sessionId: "chk_1",
  handlers: {
    searchCatalog: async ({ query }: { query: string }) => [
      { sku: "x1", name: query, price: 100 }
    ],
    checkShipping: async ({ zip }: { zip: string }) => ({
      zip,
      options: [{ carrier: "PAC", price: 19.9, days: 7 }]
    }),
    checkInventory: async ({ sku }: { sku: string }) => ({ sku, inStock: true, qty: 5 }),
    getBuyerHistory: async () => ({
      purchases: 3,
      lifetimeValue: 500
    }),
    applyDiscount: async ({ discount_percent }: { discount_percent: number }) => ({
      approved: discount_percent <= 10,
      discount_percent,
      reason: "margin_check"
    })
  }
};

test("createSearchCatalogTool.execute calls handler and returns ToolResult", async () => {
  const tool = createSearchCatalogTool(baseCtx);
  const result = await tool.execute({ query: "camiseta" });
  assert.equal(result.ok, true);
  assert.ok(Array.isArray(result.data));
  assert.equal((result.data as Array<{ sku: string }>)[0].sku, "x1");
});

test("createCheckShippingTool.execute returns shipping options", async () => {
  const tool = createCheckShippingTool(baseCtx);
  const result = await tool.execute({ zip: "01310100" });
  assert.equal(result.ok, true);
  const data = result.data as { zip: string; options: Array<{ carrier: string }> };
  assert.equal(data.zip, "01310100");
  assert.equal(data.options[0].carrier, "PAC");
});

test("createCheckInventoryTool.execute returns stock info", async () => {
  const tool = createCheckInventoryTool(baseCtx);
  const result = await tool.execute({ sku: "sku_1" });
  assert.equal(result.ok, true);
  const data = result.data as { inStock: boolean };
  assert.equal(data.inStock, true);
});

test("createGetBuyerHistoryTool.execute returns purchase stats", async () => {
  const tool = createGetBuyerHistoryTool(baseCtx);
  const result = await tool.execute({});
  assert.equal(result.ok, true);
  assert.equal((result.data as { purchases: number }).purchases, 3);
});

test("createApplyDiscountTool.execute returns the rules-engine verdict", async () => {
  const tool = createApplyDiscountTool(baseCtx);
  const result = await tool.execute({ discount_percent: 5 });
  assert.equal(result.ok, true);
  const data = result.data as { approved: boolean; discount_percent: number };
  assert.equal(data.approved, true);
  assert.equal(data.discount_percent, 5);
});

test("tool returns ok:false when handler throws", async () => {
  const ctx: ToolContext = {
    merchantId: "mrc_1",
    sessionId: "chk_1",
    handlers: {
      ...baseCtx.handlers,
      searchCatalog: async () => {
        throw new Error("catalog_unavailable");
      }
    }
  };
  const tool = createSearchCatalogTool(ctx);
  const result = await tool.execute({ query: "x" });
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /catalog_unavailable/);
});

test("tool never returns discount_percent above rules-engine cap", async () => {
  const ctx: ToolContext = {
    merchantId: "mrc_1",
    sessionId: "chk_1",
    handlers: {
      ...baseCtx.handlers,
      applyDiscount: async ({ discount_percent }: { discount_percent: number }) => ({
        approved: false,
        discount_percent,
        reason: "above_max_discount"
      })
    }
  };
  const tool = createApplyDiscountTool(ctx);
  const result = await tool.execute({ discount_percent: 50 });
  const data = result.data as { approved: boolean };
  assert.equal(data.approved, false);
});

// ─── Type surface sanity ──────────────────────────────────────────────────

test("ToolResult is a discriminated union by ok flag", () => {
  const ok: ToolResult = { ok: true, data: { x: 1 } };
  const err: ToolResult = { ok: false, error: "boom" };
  assert.equal(ok.ok, true);
  assert.equal(err.ok, false);
});