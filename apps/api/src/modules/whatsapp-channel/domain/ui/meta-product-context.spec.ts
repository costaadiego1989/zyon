import test from "node:test";
import assert from "node:assert/strict";
import { withMetaProductReferences } from "./meta-product-context.js";
import type { MetaUiView, WhatsAppConversationState } from "./meta-ui.types.js";

const view = (ids = ["one", "two"]): MetaUiView => ({ title: "Loja", body: "Confira as opções.", media: [], quickReplies: [],
  blocks: [{ type: "product_carousel", data: { products: ids.map(id => ({ id, name: "Bruma", price: 7990 })) } } as any],
  choices: ids.map(id => ({ label: "Bruma", action: { kind: "tool", tool: "get_product_details", args: { productId: id } } })) });
const state = (): WhatsAppConversationState => ({ version: 1, conversationId: "owned", stage: "store", page: 0, revision: "r1",
  history: [{ role: "user", content: "Até 100 reais" }, { role: "assistant", content: "Confira as opções." }], previousViews: [], view: view() });

test("identical product names retain distinct displayed ids without cached price or stock claims", () => {
  const before = state(), snapshot = structuredClone(before);
  const history = withMetaProductReferences(before);
  assert.deepEqual(before, snapshot);
  assert.equal(history[0]!.content, "Até 100 reais");
  assert.match(history[1]!.content, /"id":"one".*"id":"two"/);
  assert.doesNotMatch(history[1]!.content, /7990|price|inStock/);
});

test("current pagination uses only products actually offered on that page", () => {
  const input = state();input.view = view(["one", "two", "three"]);
  input.numericSelections = [input.view.choices[1]!.action, input.view.choices[2]!.action, { kind: "message", message: "/atalhos" }];
  const text = withMetaProductReferences(input).at(-1)!.content;
  assert.match(text, /"id":"two"/);assert.match(text, /"id":"three"/);assert.doesNotMatch(text, /"id":"one"/);
});

test("a failed comparison can recover the immediately previous product view, never a distant arbitrary view", () => {
  const input = state();input.view = { ...view(), blocks: [], choices: [] };input.previousViews = [view()];
  assert.match(withMetaProductReferences(input).at(-1)!.content, /"id":"two"/);
  input.previousViews.push({ ...view(), blocks: [], choices: [] });
  assert.deepEqual(withMetaProductReferences(input), input.history);
});

test("an oversized product set is not silently reduced to its first pair", () => {
  const input = state();input.view = view(["a", "b", "c", "d", "e", "f"]);
  assert.deepEqual(withMetaProductReferences(input), input.history);
});
