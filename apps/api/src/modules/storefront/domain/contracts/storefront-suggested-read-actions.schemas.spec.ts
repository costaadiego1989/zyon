import test from "node:test";
import assert from "node:assert/strict";
import { storefrontSuggestedReadActionsSchema } from "./storefront-suggested-read-actions.schemas.js";

const item = { id: "read-action-1", label: "Ver detalhes", action: { tool: "get_product_details", args: { productId: "product" } } };
const envelope = { version: 1, items: [item] };
test("suggested actions strict envelope accepts its public read contract and clones action arguments", () => {
  const parsed = storefrontSuggestedReadActionsSchema.parse(envelope);
  assert.deepEqual(parsed, envelope);
  assert.notEqual(parsed.items[0].action.args, item.action.args);
});
for (const [name, value] of [
  ["wrong version", { ...envelope, version: 2 }], ["string version", { ...envelope, version: "1" }],
  ["unknown envelope field", { ...envelope, merchantId: "foreign" }],
  ["too many items", { version: 1, items: Array.from({ length: 13 }, (_, index) => ({ ...item, id: `action-${index}` })) }],
  ["duplicate IDs", { version: 1, items: [item, { ...item, label: "Other label" }] }],
  ["blank id", { version: 1, items: [{ ...item, id: " " }] }], ["oversized id", { version: 1, items: [{ ...item, id: "x".repeat(192) }] }],
  ["blank label", { version: 1, items: [{ ...item, label: " " }] }], ["oversized label", { version: 1, items: [{ ...item, label: "x".repeat(501) }] }],
  ["unknown item field", { version: 1, items: [{ ...item, price: 100 }] }],
  ["write action", { version: 1, items: [{ ...item, action: { tool: "add_item_to_cart", args: { variantId: "v", quantity: 1 } } }] }],
  ["question submission remains an explicit form action", { version: 1, items: [{ ...item, action: { tool: "create_question", args: { productId: "p", question: "Pergunta?" } } }] }],
  ["cart injection", { version: 1, items: [{ ...item, action: { tool: "get_product_details", args: { productId: "product", cartId: "foreign" } } }] }],
  ["text search", { version: 1, items: [{ ...item, action: { tool: "search_products", args: { query: "label", categoryId: "category" } } }] }],
] as const) test(`suggested actions reject ${name} atomically`, () => assert.equal(storefrontSuggestedReadActionsSchema.safeParse(value).success, false));

test("suggested action presentation ID and label accept their exact public upper bounds", () => {
  assert.equal(storefrontSuggestedReadActionsSchema.safeParse({ version: 1, items: [{ ...item, id: "x".repeat(191), label: "x".repeat(500) }] }).success, true);
});

test("an empty valid envelope is representable but the server projector omits it from responses", () => {
  assert.deepEqual(storefrontSuggestedReadActionsSchema.parse({ version: 1, items: [] }), { version: 1, items: [] });
});

