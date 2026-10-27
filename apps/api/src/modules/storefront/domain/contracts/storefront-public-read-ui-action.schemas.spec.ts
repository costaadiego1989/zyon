import test from "node:test";
import assert from "node:assert/strict";
import { storefrontPublicReadUiActionSchema, storefrontPublicReadUiActionRequestSchema, storefrontReadUiActionCapability } from "./storefront-public-read-ui-action.schemas.js";
import { storefrontUiActionSchema } from "./storefront-ui-action.schemas.js";

test("public read schema preserves the internal seventeen-action union without exposing it", () => {
  const tools = storefrontUiActionSchema.options.map(option => option.shape.tool.value);
  assert.equal(tools.length, 17);
  const publicTools = storefrontReadUiActionCapability().tools;
  assert.deepEqual(publicTools, ["search_products", "get_product_details"]);
  for (const tool of tools) {
    if (publicTools.some(publicTool => publicTool === tool)) continue;
    assert.equal(storefrontPublicReadUiActionSchema.safeParse({ tool, args: {} }).success, false, tool);
  }
});

for (const length of [1, 191]) {
  test(`public read schema retains exact ${length}-character identifiers without coercion or label parsing`, () => {
    for (const action of [
      { tool: "get_product_details", args: { productId: "p".repeat(length) } },
      { tool: "search_products", args: { query: "*", categoryId: "c".repeat(length) } },
    ]) assert.deepEqual(storefrontPublicReadUiActionSchema.parse(action), action);
  });
}

test("public read schema never coerces malformed arguments or strips extra authorization keys", () => {
  for (const action of [
    { tool: "get_product_details", args: { productId: "product", merchant_id: "foreign" } },
    { tool: "get_product_details", args: { productId: "product", quantity: 1 } },
    { tool: "get_product_details", args: { productId: "product" }, cart_id: "foreign" },
    { tool: "search_products", args: { query: "*", categoryId: "category", cursor: 1 } },
    { tool: "search_products", args: { query: "*", categoryId: "category", sortBy: "price_asc" } },
    { tool: "search_products", args: { query: "*", categoryId: "category", limit: 100 } },
  ]) assert.equal(storefrontPublicReadUiActionSchema.safeParse(action).success, false);
});

test("public request schema requires version and action together and validates the display label", () => {
  const action = { tool: "get_product_details", args: { productId: "product" } };
  assert.equal(storefrontPublicReadUiActionRequestSchema.safeParse({ ui_action_version: 1, user_message: "Label" }).success, false);
  assert.equal(storefrontPublicReadUiActionRequestSchema.safeParse({ ui_action: action, user_message: "Label" }).success, false);
  assert.equal(storefrontPublicReadUiActionRequestSchema.safeParse({ ui_action_version: 1, ui_action: action, user_message: "  " }).success, false);
  assert.equal(storefrontPublicReadUiActionRequestSchema.safeParse({ ui_action_version: 1, ui_action: action, user_message: "Label", merchantId: "foreign" }).success, false);
});

test("capability metadata uses independent response objects, not a mutable shared authority", () => {
  const first = storefrontReadUiActionCapability();
  const second = storefrontReadUiActionCapability();
  assert.notEqual(first, second);
  assert.notEqual(first.tools, second.tools);
  first.tools.pop();
  assert.deepEqual(second, { version: 1, tools: ["search_products", "get_product_details"] });
});

