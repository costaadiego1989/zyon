import test from "node:test";
import assert from "node:assert/strict";
import { buildMetaUiView, presentMetaUi, formatMetaText, withMetaCartNavigation, metaWelcomeMessage } from "./meta-ui-renderer.js";
import type { WhatsAppStructuredResponse } from "./meta-ui.types.js";

const response = (overrides: Partial<WhatsAppStructuredResponse> = {}): WhatsAppStructuredResponse => ({ agentMessage: "Como posso ajudar?", merchantName: "Loja Exemplo", quickReplies: [], blocks: [], state: { version: 1, conversationId: "conversation", stage: "store", history: [], revision: "turn", page: 0, previousViews: [] }, ...overrides });
const native = (presentation: ReturnType<typeof presentMetaUi>) => presentation.messages.filter(m => m.type === "interactive").map(m => m.type === "interactive" ? m.interactive as any : null);

test("store rich text retains native bold, italic and heading hierarchy without HTML", () => {
  assert.equal(formatMetaText('<strong>Resumo</strong>\n<em>Entrega estimada</em>\n## Seu pedido\n**Total** <script>unsafe()</script>'), '*Resumo*\n_Entrega estimada_\n*Seu pedido*\n*Total* ');
});

test("welcome retains merchant copy and explicitly invites unrestricted conversation", () => {
  const message = metaWelcomeMessage("Olá! Encontre produtos e confira seu pedido.", "Athom", "Zyon");
  assert.match(message, /^\*Zyon · Athom\*/);
  assert.match(message, /\*Converse à vontade\*/);
  assert.match(message, /Pergunte o que quiser/);
  assert.ok(message.includes("Olá! Encontre produtos e confira seu pedido."));
});

test("catalog prioritizes actual photos and retains products without photos on later pages", () => {
  const view = withMetaCartNavigation(buildMetaUiView(response({ blocks: [{ type: "product_carousel", data: { products: [
    { id: "test", name: "Teste", price: 500 }, { id: "serum", name: "Sérum", price: 18990, image: "https://cdn.example/serum.jpg" },
  ] } }] })), true);
  const shown = presentMetaUi(view, "turn");
  assert.ok(shown.messages.some(m => m.type === "image" && m.media.link === "https://cdn.example/serum.jpg"));
  const products = shown.numericSelections.filter(a => a.kind === "tool" && a.tool === "get_product_details");
  assert.deepEqual(products.map(a => a.kind === "tool" && a.args.productId), ["serum", "test"]);
  const menu = native(shown).find(m => m.type === "list");
  assert.equal(menu.footer.text, "Pode perguntar o que quiser.");
  assert.equal(menu.action.sections[0].rows[0].title, "1. Ver produtos");
  assert.equal(menu.action.sections[0].rows[1].title, "2. Encontrar produto");
});

test("cart shows the real product photo alongside its authoritative amount", () => {
  const view = buildMetaUiView(response({ blocks: [{ type: "cart_summary", data: { items: [{ variantId: "v", name: "Sérum", quantity: 1, subtotal: 189.9, imageUrl: "https://cdn.example/serum.jpg" }], subtotal: 189.9, total: 189.9 } }] as any }));
  assert.ok(view.media.some(m => m.type === "image" && m.media.caption?.includes("189,90")));
});
test("product photos follow their selectable native page, including later pages", () => {
  const view = buildMetaUiView(response({ blocks: [{ type: "product_carousel", data: { products: Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, name: `Produto ${i}`, price: 1000 + i, image: `https://example.com/${i}.jpg` })) } }] }));
  const first = presentMetaUi(view, "turn", 0);
  const second = presentMetaUi(view, "turn", 1, { includeMedia: false });
  assert.deepEqual(first.messages.filter(m => m.type === "image").map(m => m.type === "image" && m.media.link), [0, 1, 2].map(i => `https://example.com/${i}.jpg`));
  assert.deepEqual(second.messages.filter(m => m.type === "image").map(m => m.type === "image" && m.media.link), [3, 4].map(i => `https://example.com/${i}.jpg`));
  assert.equal(second.numericSelections[0].kind === "tool" && second.numericSelections[0].args.productId, "p3");
});
test("secure checkout button preserves the entire signed URL without text-formatting its credentials", () => {
  const url = "https://widget.example/?embedToken=signed_token.signature&merchantId=own";
  const shown = presentMetaUi(buildMetaUiView(response({ blocks: [{ type: "checkout_redirect", data: { url } }] })), "turn");
  const button = native(shown).find(item => item.type === "cta_url");
  assert.equal(button.action.parameters.url, url);
  assert.ok(!shown.messages.some(message => message.type === "text" && message.text.body.includes("signed_token")));
});

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
  assert.deepEqual(shown.selections[button.id], { kind: "tool", tool: "search_products", args: { query: "*" } });
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
  assert.equal(shown.choices[0].action.kind === "tool" ? shown.choices[0].action.args.text : null, "*Tem garantia?*\n\n12 meses");
});

test("numeric presentation preserves the same actions as a native menu", () => {
  const view = buildMetaUiView(response({ quickReplies: ["Ver produtos", "Categorias", "Suporte", "Ofertas"] }));
  const nativeMenu = presentMetaUi(view, "turn"); const numeric = presentMetaUi(view, "turn", 0, { native: false });
  assert.deepEqual(numeric.numericSelections, nativeMenu.numericSelections);
  assert.equal(native(numeric).length, 0);
});

test("long content and every media remain accessible without flooding the conversation", () => {
  const text = "Detalhes do produto. ".repeat(900);
  const view = buildMetaUiView(response({ blocks: [{ type: "product_content", data: { blocks: [
    { type: "paragraph", text }, ...Array.from({ length: 9 }, (_, i) => ({ type: "image", src: `https://example.com/${i}.jpg` })),
  ] } }] }));
  const shown = presentMetaUi(view, "turn");
  assert.equal(shown.messages.filter(m => m.type === "image").length, 3);
  assert.ok(Object.values(shown.selections).some(a => a.kind === "tool" && a.tool === "media_page" && (a.args.media as unknown[]).length === 6));
  assert.ok(Object.values(shown.selections).some(a => a.kind === "tool" && a.tool === "show_content" && String(a.args.text).length > 7000));
  assert.ok(shown.messages.filter(m => m.type === "text").length <= 2);
});

test("checkout uses the payable total including the fee and real shipping selection", () => {
  const view = buildMetaUiView(response({ blocks: [
    { type: "checkout_summary", data: { items: [{ name: "Item", quantity: 2, line_total: 100 }], totals: { subtotal: 100, shipping: 10, discount: 5, service_fee: 0.99, total: 105, total_to_pay: 105.99 } } },
    { type: "shipping_options", data: { options: [{ name: "PAC", price: 10, days: 5, responseLabel: "Correios PAC (5 dias) - R$ 10,00" }] } },
  ] }));
  assert.match(view.body, /105,99/); assert.match(view.body, /Taxa de serviço/);
  assert.deepEqual(view.choices[0].action, { kind: "message", message: "Correios PAC (5 dias) - R$ 10,00" });
});

test("a scheduled service cannot be added before a selectable slot is chosen", () => {
  const base = response({ blocks: [{ type: "product_card", data: { id: "service", name: "Consulta", price: 10000, priceFormatted: "R$ 100,00", inStock: true, productType: "service",
    variants: [{ id: "v1", value: "Consulta", stock: 0 }], serviceSchedule: { slots: [
      { slotId: "past", date: "2026-01-01", startTime: "10:00", durationMinutes: 30, timeZone: "America/Sao_Paulo", selectable: false },
      { slotId: "future", date: "2026-12-01", startTime: "10:00", durationMinutes: 30, timeZone: "America/Sao_Paulo", selectable: true },
    ] } } } as any] });
  const before = buildMetaUiView(base);
  assert.equal(before.choices.some(c => c.action.kind === "tool" && c.action.tool === "add_item_to_cart"), false);
  assert.deepEqual(before.choices.find(c => c.action.kind === "slot")?.action, { kind: "slot", productId: "service", slotId: "future" });
  const after = buildMetaUiView({ ...base, state: { ...base.state, selectedServiceSlotId: "future" } });
  const add = after.choices.find(c => c.action.kind === "tool" && c.action.tool === "add_item_to_cart");
  assert.equal(add?.action.kind === "tool" ? add.action.args.selectedServiceSlotId : null, "future");
});

test("every rich-content add CTA uses the selected variant instead of reopening details", () => {
  const base = response({ blocks: [
    { type: "product_card", data: { id: "serum", name: "Serum", inStock: true, variants: [
      { id: "small", value: "30 ml", stock: 4 }, { id: "large", value: "50 ml", stock: 24 },
    ] } },
    { type: "product_content", data: { productId: "serum", blocks: [
      { type: "banner", ctaAction: "add_to_cart", ctaLabel: "Adicionar ao carrinho" },
      { type: "button", linkType: "add_to_cart", label: "Adicionar ao carrinho" },
    ] } },
  ] as any, quickReplies: ["Adicionar ao Carrinho", "Mais Informações"] });
  const view = buildMetaUiView({ ...base, state: { ...base.state, selectedProductId: "serum", selectedVariantId: "large" } });
  const adds = view.choices.filter(c => /^adicionar.*carrinho$/i.test(c.label));
  assert.equal(adds.length, 1, "the shopper must never see competing Add actions");
  assert.equal(adds[0].action.kind === "tool" && adds[0].action.tool, "add_item_to_cart");
  assert.equal(adds[0].action.kind === "tool" && adds[0].action.args.variantId, "large");
});

test("rich CTAs cannot bypass missing variants, required options or unavailable stock", () => {
  for (const patch of [
    { variants: [{ id: "v1", stock: 2 }, { id: "v2", stock: 2 }] },
    { variants: [{ id: "v1", stock: 2 }], optionGroups: [{ id: "size", name: "Tamanho", required: true, items: [{ id: "large", name: "Grande" }] }] },
    { inStock: false, variants: [{ id: "v1", stock: 0 }] },
  ]) {
    const view = buildMetaUiView(response({ blocks: [
      { type: "product_card", data: { id: "p1", name: "Produto", inStock: true, ...patch } },
      { type: "product_content", data: { productId: "p1", blocks: [{ type: "button", linkType: "add_to_cart", label: "Adicionar ao carrinho" }] } },
    ] as any }));
    assert.equal(view.choices.some(c => /^adicionar.*carrinho$/i.test(c.label)), false);
  }
});

test("a remembered sold-out or foreign variant never produces an Add action", () => {
  for (const selectedVariantId of ["sold-out", "foreign"]) {
    const base = response({ blocks: [{ type: "product_card", data: { id: "p1", name: "Produto", inStock: true,
      variants: [{ id: "available", stock: 2 }, { id: "sold-out", stock: 0 }] } }] as any });
    const view = buildMetaUiView({ ...base, state: { ...base.state, selectedProductId: "p1", selectedVariantId } });
    assert.equal(view.choices.some(c => c.action.kind === "tool" && c.action.tool === "add_item_to_cart"), false);
    assert.ok(view.choices.some(c => c.action.kind === "variant" && c.action.variantId === "available"));
  }
});

test("a cross-sell opens its authoritative product ID while preserving the storefront variant reference", () => {
  const view = buildMetaUiView(response({ blocks: [{ type: "cross_sell", data: { products: [
    { id: "variant-creme", productId: "product-creme", name: "Creme", priceFormatted: "R$ 10,00" },
  ] } }] as any }));
  assert.deepEqual(view.choices[0].action, { kind: "tool", tool: "get_product_details", args: { productId: "product-creme" } });
});

test("an actual cart always offers checkout and shopping navigation even with welcome-only shortcuts", () => {
  const view = buildMetaUiView(response({ blocks: [{ type: "cart_summary", data: { items: [
    { variantId: "large", productName: "Serum 50 ml", quantity: 1, subtotal: 189.90 },
  ], total: 189.90 } }] as any, quickReplies: ["Ver Produtos", "Categorias"] }));
  assert.ok(view.choices.some(c => c.action.kind === "tool" && c.action.tool === "checkout"));
  assert.ok(view.choices.some(c => c.action.kind === "tool" && c.action.tool === "search_products"));
});

test("an empty cart offers shopping navigation and cannot expose a checkout control", () => {
  const view = buildMetaUiView(response({ blocks: [{ type: "cart_summary", data: { items: [], total: 0 } }] as any,
    quickReplies: ["Finalizar Compra", "Continuar Comprando"] }));
  assert.ok(!view.choices.some(c => c.action.kind === "tool" && c.action.tool === "checkout"));
  assert.ok(view.choices.some(c => c.action.kind === "tool" && c.action.tool === "search_products"));
});

test("cart and checkout remain pinned on every native page without losing product choices", () => {
  const base = buildMetaUiView(response({ blocks: [{ type: "product_carousel", data: { products: Array.from({ length: 16 }, (_, i) => ({ id: `p${i}`, name: `Produto ${i}`, price: 500, image: `https://img.example/${i}.jpg` })) } }] as any }));
  const view = withMetaCartNavigation(base, true);
  const seen = new Set<string>();
  const first = presentMetaUi(view, "turn", 0, { canGoBack: true });
  for (let page = 0; page < first.totalPages; page++) {
    const shown = presentMetaUi(view, "turn", page, { canGoBack: true });
    assert.deepEqual(shown.numericSelections.slice(0, 4).map(a => a.kind === "tool" ? a.tool : a.kind === "message" ? a.message : a.kind), ["search_products", "Encontrar produto", "get_cart", "checkout"]);
    assert.ok(shown.numericSelections.length <= 10, "Meta lists accept at most ten rows");
    for (const action of shown.numericSelections) if (action.kind === "tool" && action.tool === "get_product_details") seen.add(String(action.args.productId));
  }
  assert.equal(seen.size, 16);
  const empty = withMetaCartNavigation(view, false);
  assert.ok(empty.choices.every(c => c.action.kind !== "tool" || !["get_cart", "checkout"].includes(c.action.tool)));
});
