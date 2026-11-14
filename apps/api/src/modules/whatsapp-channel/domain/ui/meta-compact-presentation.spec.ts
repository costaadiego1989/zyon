import test from "node:test";
import assert from "node:assert/strict";
import { compactMetaPresentation, metaCatalogCopy } from "./meta-compact-presentation.js";
import { buildMetaUiView, presentMetaUi } from "./meta-ui-renderer.js";
import type { MetaUiView, MetaUiMessage } from "./meta-ui.types.js";
const view: MetaUiView = { title: "Loja", body: "", choices: [], media: [], blocks: [], quickReplies: [] };
const menu: MetaUiMessage = { type: "interactive", interactive: { type: "button", body: { text: "Escolha como continuar." }, action: { buttons: [] } } };
test("catalog count correction is idempotent and keeps budget and indication caveats", () => {
  const blocks: any = [{ type: "product_carousel", data: { query: "pele", criteria: { maxPriceCents: 10000 }, products: [{ id: "a" }, { id: "b" }] } }];
  const copy = metaCatalogCopy("Encontrei 3 opções disponíveis nesta página com preço até R$100. Indicação para pele oleosa não confirmada.", blocks);
  assert.match(copy, /2 opções nesta busca/); assert.match(copy, /até R\$100/); assert.match(copy, /oleosa não confirmada/);
  assert.equal(metaCatalogCopy(copy, blocks), copy);
});
test("compact prose and controls preserve raw Pix as an exact separate payload", () => {
  const pix = "000201" + "1234567890".repeat(30);
  const messages: MetaUiMessage[] = [{ type: "text", text: { body: "Total: R$ 3,00" } }, { type: "text", text: { body: pix } }, menu];
  assert.deepEqual(compactMetaPresentation(messages, view), messages);
  const image: MetaUiMessage = { type: "image", media: { link: "https://example.test/photo.png" } };
  const separated: MetaUiMessage[] = [{ type: "text", text: { body: "Antes" } }, image, { type: "text", text: { body: "Depois" } }];
  assert.deepEqual(compactMetaPresentation(separated, view), separated);
});
test("compact cart keeps separate variant labels, one total and three primary controls", () => {
  const state: any = { version: 1, conversationId: "cart", stage: "store", history: [], revision: "r", page: 0, previousViews: [] };
  const response: any = { state, agentMessage: "Este é o seu carrinho:", quickReplies: [], blocks: [{ type: "cart_summary", data: { items: [
    { variantId: "a", productName: "Sérum", variantLabel: "50 ml", quantity: 3, subtotal: 300 },
    { variantId: "b", productName: "Sérum", variantLabel: "30 ml", quantity: 1, subtotal: 50, optionItemIds: ["extra"], serviceSlotId: "slot" },
  ], subtotal: 350, total: 350 } }] };
  const root = presentMetaUi(buildMetaUiView(response), "r");
  assert.equal(root.messages.length, 1); assert.equal(root.messages[0]!.type, "interactive");
  const copy = (root.messages[0] as any).interactive.body.text;
  assert.match(copy, /50 ml/); assert.match(copy, /30 ml/); assert.equal((copy.match(/\*Total:/g) ?? []).length, 1);
  assert.deepEqual(root.numericSelections.map(a => a.kind === "tool" ? a.tool : a.kind), ["checkout", "cart_edit_items", "search_products"]);
  const editing = buildMetaUiView(response, { cartEditing: true });
  const action = editing.choices.find(c => c.action.kind === "tool" && c.action.tool === "edit_cart_item" && c.action.args.variantId === "b")!.action as any;
  assert.deepEqual(action.args, { variantId: "b", quantity: 1, optionItemIds: ["extra"], serviceSlotId: "slot" });
});

for (const type of ["welcome_animation", "commerce_animation", "payment_paid_animation"]) test(`${type} is first even with long prose or a raw Pix payload`, () => {
  const animation: MetaUiMessage = { type: "sticker", media: { link: "https://example.test/event.webp" } };
  const decorated: any = { ...view, blocks: [{ type, data: { url: animation.media.link } }] };
  for (const content of ["Compra confirmada", "Informação publicada. ".repeat(80), "000201" + "1234".repeat(40)]) {
    const messages: MetaUiMessage[] = [{ type: "text", text: { body: content } }, animation, menu];
    const before = structuredClone(messages);
    const shown = compactMetaPresentation(messages, decorated);
    assert.deepEqual(shown[0], animation);
    assert.deepEqual(messages, before);
    assert.ok(JSON.stringify(shown).includes(content), "the animation cannot discard or alter payment/receipt data");
  }
});
