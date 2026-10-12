import test from "node:test";
import assert from "node:assert/strict";
import { buildMetaUiView, presentMetaUi } from "./meta-ui-renderer.js";
import type { WhatsAppStructuredResponse } from "./meta-ui.types.js";

const response = (overrides: Partial<WhatsAppStructuredResponse> = {}): WhatsAppStructuredResponse => ({ agentMessage: "Como posso ajudar?", merchantName: "Loja Exemplo", quickReplies: [], blocks: [], state: { version: 1, conversationId: "conversation", stage: "store", history: [], revision: "turn", page: 0, previousViews: [] }, ...overrides });
const native = (presentation: ReturnType<typeof presentMetaUi>) => presentation.messages.filter(m => m.type === "interactive").map(m => m.type === "interactive" ? m.interactive as any : null);

test("all configured quick replies remain selectable across native pages", () => {
  const labels = Array.from({ length: 31 }, (_, i) => `Pergunta completa ${i + 1}`);
  const view = buildMetaUiView(response({ quickReplies: labels }));
  const seen: string[] = [];
  for (let page = 0; page < Math.ceil(labels.length / 7); page++) {
    const shown = presentMetaUi(view, "turn", page, { canGoBack: true });
    const list = native(shown)[0];
    assert.equal(list.type, "list");
    assert.ok(list.action.sections[0].rows.length <= 10);
    for (const action of Object.values(shown.selections)) if (action.kind === "message") seen.push(action.message);
  }
  assert.deepEqual(seen, labels);
});

test("short choices use native buttons and IDs remain bound to the original action", () => {
  const view = buildMetaUiView(response({ quickReplies: ["Ver produtos", "Suporte"] }));
  const shown = presentMetaUi(view, "turn-a");
  const button = native(shown)[0].action.buttons[0].reply;
  assert.equal(native(shown)[0].type, "button");
  assert.deepEqual(shown.selections[button.id], { kind: "message", message: "Ver produtos" });
  assert.notEqual(button.id, native(presentMetaUi(view, "turn-b"))[0].action.buttons[0].reply.id);
});

test("duplicate or abbreviated titles cannot swap the selected product ID", () => {
  const name = "Produto com nome longo igual em duas variantes";
  const view = buildMetaUiView(response({ blocks: [{ type: "product_carousel", data: { products: [{ id: "p1", name, priceFormatted: "R$ 10,00" }, { id: "p2", name, priceFormatted: "R$ 20,00" }] } }] as any }));
  const shown = presentMetaUi(view, "turn");
  const actions = Object.values(shown.selections).filter(a => a.kind === "tool");
  assert.deepEqual(actions.map(a => a.kind === "tool" ? a.args.productId : null), ["p1", "p2"]);
  assert.equal(shown.numericSelections.length, 2);
});

test("a product with multiple variants never authorizes adding the first variant", () => {
  const product = { type: "product_card", data: { id: "p1", name: "Camiseta", price: 1990, inStock: true, variants: [{ id: "v1", value: "P", stock: 3 }, { id: "v2", value: "M", stock: 2 }] } };
  const unselected = buildMetaUiView(response({ blocks: [product] as any, quickReplies: ["Adicionar ao carrinho"] }));
  assert.ok(!unselected.choices.some(c => c.action.kind === "tool" && c.action.tool === "add_item_to_cart"));
  const selectedResponse = response({ blocks: [product] as any });
  selectedResponse.state.selectedProductId = "p1"; selectedResponse.state.selectedVariantId = "v2";
  const add = buildMetaUiView(selectedResponse).choices.find(c => c.action.kind === "tool" && c.action.tool === "add_item_to_cart");
  assert.equal(add?.action.kind === "tool" ? add.action.args.variantId : undefined, "v2");
});

test("required food options precede authorization to add the product", () => {
  const block = { type: "product_card", data: { id: "pizza", name: "Pizza", price: 3000, inStock: true, variants: [{ id: "v1", value: "Única", stock: 1 }], optionGroups: [{ id: "size", name: "Tamanho", required: true, items: [{ id: "large", name: "Grande", priceModifierInCents: 1000 }] }] } };
  const before = buildMetaUiView(response({ blocks: [block] as any }));
  assert.equal(before.choices[0].action.kind, "option");
  assert.ok(!before.choices.some(c => c.action.kind === "tool" && c.action.tool === "add_item_to_cart"));
});

test("Pix payload is sent alone after its instructions and amount uses cents", () => {
  const code = "000201PIX-COPIA-E-COLA";
  const shown = presentMetaUi(buildMetaUiView(response({ blocks: [{ type: "payment_intent", data: { amount_cents: 10000, copy_paste: code } }] })), "turn");
  const text = shown.messages.filter(m => m.type === "text");
  assert.ok(text[0].type === "text" && text[0].text.body.includes("100,00"));
  assert.equal(text[1].type === "text" ? text[1].text.body : null, code);
});

test("rich content preserves ordered text, real media, tables and FAQ selections", () => {
  const shown = buildMetaUiView(response({ blocks: [{ type: "product_content", data: { blocks: [
    { type: "paragraph", order: 2, text: "Texto depois" }, { type: "heading", order: 1, text: "Título primeiro" },
    { type: "table", order: 3, headers: ["Peso"], rows: [["1 kg"]] },
    { type: "image", order: 4, src: "https://example.com/photo.jpg", alt: "Produto" },
    { type: "image", order: 5, src: "javascript:alert(1)" },
    { type: "faq", order: 6, items: [{ question: "Tem garantia?", answer: "12 meses" }] },
  ] } }] }));
  assert.ok(shown.body.indexOf("Título primeiro") < shown.body.indexOf("Texto depois"));
  assert.ok(shown.body.includes("Peso: 1 kg"));
  assert.equal(shown.media.length, 1);
  assert.equal(shown.choices[0].action.kind === "tool" ? shown.choices[0].action.args.text : null, "12 meses");
});

test("numeric presentation preserves the same actions as a native menu", () => {
  const view = buildMetaUiView(response({ quickReplies: ["Ver produtos", "Categorias", "Suporte", "Ofertas"] }));
  const nativeMenu = presentMetaUi(view, "turn"); const numeric = presentMetaUi(view, "turn", 0, { native: false });
  assert.deepEqual(numeric.numericSelections, nativeMenu.numericSelections);
  assert.equal(native(numeric).length, 0);
});
