import test from "node:test";
import assert from "node:assert/strict";
import { buildMetaUiView, presentMetaUi, metaWelcomeMessage } from "./meta-ui-renderer.js";
import { metaProductRating } from "./meta-catalog-cards.js";
import type { WhatsAppStructuredResponse } from "./meta-ui.types.js";

const state = { version: 1 as const, conversationId: "cart", stage: "store" as const, history: [], revision: "r", page: 0, previousViews: [] };
const product = (i: number) => ({ id: `p${i}`, name: `Mouse ${i}`, price: 6990, priceFormatted: "R$ 69,90", description: "Mouse sem fio com receptor USB.", inStock: true,
  image: `https://example.test/p${i}.jpg`, rating: 4.4, reviewCount: 12, variants: [{ id: `v${i}`, stock: 10 }] });
const response = (products: any[]): WhatsAppStructuredResponse => ({ state, agentMessage: `Confira os ${products.length} produtos desta lista.`, quickReplies: [], blocks: [{ type: "product_carousel", data: { products, query: "*" } }] as any });

test("each product card binds its own Add and Details and shows real ratings with no installment promise", () => {
  const view = buildMetaUiView(response([product(0), product(1)]));
  const before = structuredClone(view), shown = presentMetaUi(view, "fresh");
  assert.deepEqual(view, before);
  const cards = shown.messages.filter((m: any) => m.type === "interactive" && m.interactive.header) as any[];
  assert.equal(cards.length, 2);
  for (const [index, card] of cards.entries()) {
    assert.equal(card.interactive.header.image.link, `https://example.test/p${index}.jpg`);
    assert.match(card.interactive.body.text, /69,90/); assert.match(card.interactive.body.text, /★★★★☆ \*4,4\/5\* · 12 avaliações/);
    assert.match(card.interactive.body.text, /Mouse sem fio com receptor USB/);
    assert.doesNotMatch(card.interactive.body.text, /parcel|sem juros|1x|12x|Stripe|Mercado Pago|Asaas/i);
    const [add, details] = card.interactive.action.buttons;
    assert.equal(add.reply.title, "🛒 Adicionar"); assert.equal(details.reply.title, "Ver detalhes");
    assert.deepEqual(shown.selections[add.reply.id], { kind: "tool", tool: "add_item_to_cart", args: { variantId: `v${index}`, quantity: 1, selectedOptionItemIds: [] } });
    assert.deepEqual(shown.selections[details.reply.id], { kind: "tool", tool: "get_product_details", args: { productId: `p${index}` } });
  }
});

test("ten products remain reachable in groups of three, with scoped counts and numeric parity", () => {
  const view = buildMetaUiView(response(Array.from({ length: 10 }, (_, i) => product(i))));
  const seen = new Set();
  for (let page = 0; page < 4; page++) {
    const shown = presentMetaUi(view, "r", page), fallback = presentMetaUi(view, "r", page, { native: false });
    assert.deepEqual(shown.numericSelections, fallback.numericSelections);
    assert.equal(shown.totalPages, 4);
    assert(shown.numericSelections.some(a => a.kind === "message" && a.message === "/atalhos"));
    assert(!shown.numericSelections.some(a => a.kind === "back" || a.kind === "tool" && ["get_cart", "checkout", "list_categories"].includes(a.tool)));
    assert.match(JSON.stringify(shown.messages.at(-1)), /de 10 nesta lista/);
    for (const action of Object.values(shown.selections)) if (action.kind === "tool" && action.tool === "get_product_details") seen.add(action.args.productId);
    for (const m of shown.messages as any[]) if (m.type === "interactive") { assert(m.interactive.action.buttons.length <= 3); assert(Array.from(m.interactive.body.text).length <= 1024); }
  }
  assert.equal(seen.size, 10);
});

test("variants, options, slots, out-of-stock items and foreign marketplace products cannot get an arbitrary direct add", () => {
  for (const p of [
    { ...product(0), inStock: false }, { ...product(0), variants: [{ id: "v0", stock: 0 }] },
    { ...product(0), variants: [{ id: "v0", stock: 0 }, { id: "v1", stock: 2 }] },
    { ...product(0), variants: [{ id: "v0", stock: 2 }, { id: "v1", stock: 2 }] },
    { ...product(0), optionGroups: [{ id: "g", required: true }] }, { ...product(0), serviceSchedule: { slots: [] } },
    { ...product(0), source: "marketplace" },
  ]) {
    const shown = presentMetaUi(buildMetaUiView(response([p])), "r");
    assert(!Object.values(shown.selections).some(a => a.kind === "tool" && a.tool === "add_item_to_cart"));
    assert(Object.values(shown.selections).some(a => a.kind === "tool" && a.tool === "get_product_details"));
  }
});

test("categories expose Exibir produtos bound to that category and main-menu navigation", () => {
  const input = { state, agentMessage: "Escolha uma categoria", quickReplies: [], blocks: [{ type: "category_carousel", data: { categories: [{ id: "owned-audio", name: "Áudio", productCount: 2 }] } }] } as WhatsAppStructuredResponse;
  const shown = presentMetaUi(buildMetaUiView(input), "r");
  const card = shown.messages.find((m: any) => m.type === "interactive" && m.interactive.action.buttons[0].reply.title === "Exibir produtos") as any;
  assert(card); assert.match(card.interactive.body.text, /Áudio/);
  assert.deepEqual(shown.selections[card.interactive.action.buttons[0].reply.id], { kind: "tool", tool: "search_products", args: { query: "*", categoryId: "owned-audio" } });
});

test("zero, missing and invalid review evidence never become invented five-star ratings", () => {
  assert.equal(metaProductRating({ rating: 5, reviewCount: 0 }), "☆☆☆☆☆ Ainda sem avaliações.");
  assert.doesNotMatch(metaProductRating({ rating: 5 }), /5\/5|Ainda sem/);
  assert.doesNotMatch(metaProductRating({ rating: NaN, reviewCount: 2 }), /NaN|5\/5/);
  assert.doesNotMatch(metaProductRating({ rating: 9, reviewCount: 12 }), /9\/5/);
});

test("single-product UI has rating stars, the canonical Add action and a main-menu entry", () => {
  const input = { state, agentMessage: "Veja os detalhes", quickReplies: [], blocks: [{ type: "product_card", data: product(0) }] } as WhatsAppStructuredResponse;
  const view = buildMetaUiView(input), shown = presentMetaUi(view, "r");
  assert.match(view.body, /★★★★☆/); assert.match(view.body, /12 avaliações/);
  assert(Object.values(shown.selections).some(a => a.kind === "tool" && a.tool === "add_item_to_cart" && a.args.variantId === "v0"));
  assert(shown.numericSelections.some(a => a.kind === "message" && a.message === "/atalhos"));
});

test("welcome retains tone and identity, explains a realistic electronics search, and has no command tutorial", () => {
  for (const tone of ["consultative", "friendly", "premium", "technical", "direct"]) {
    const message = metaWelcomeMessage("", "Athom", "Zyon", tone, "electronics");
    assert.match(message, /mouse sem fio até R\$ 150,00/); assert.match(message, /cor preta/); assert.match(message, /4 estrelas/);
    assert.match(message, /\*Menu principal\*/); assert.match(message, /Fique à vontade/);
    assert.match(message, /\*Athom\*/); assert.match(message, /\*Zyon\*/);
    assert.doesNotMatch(message, /\/atalhos|digite|comando/);
  }
});
