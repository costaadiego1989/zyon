import test from "node:test";
import assert from "node:assert/strict";
import { buildMetaUiView, presentMetaUi, withMetaCartNavigation } from "./meta-ui-renderer.js";
import { withMetaProductNavigation } from "./meta-product-navigation.js";
import { resolveMetaStoreTextAction } from "./meta-store-actions.js";
import type { MetaUiView, WhatsAppConversationState } from "./meta-ui.types.js";

const state = (): WhatsAppConversationState => ({ version: 1, conversationId: "cart", stage: "store", history: [], revision: "r", page: 0, previousViews: [] });
const surface = (blocks: any[] = []): MetaUiView => ({ title: "Fotos", body: "Confira", media: [], choices: [], blocks, quickReplies: [] });
const details = (s = state(), extra: any = {}) => buildMetaUiView({ merchantName: "Loja", agentMessage: "Detalhes", quickReplies: [], state: s,
  blocks: [{ type: "product_card", data: { id: "p", name: "Mouse", price: 6990, inStock: true, variants: [{ id: "v", stock: 3 }], ...extra } }] });

test("photos retain the admitted variant/options and expose only native add and main menu", () => {
  const s = state(), source = details(s), before = structuredClone(source);
  const view = withMetaCartNavigation(withMetaProductNavigation(surface(), source, s, "p"), true);
  const shown = presentMetaUi(view, "photo", 0, { canGoBack: true });
  assert.deepEqual(source, before);
  assert.deepEqual(shown.numericSelections.map(a => a.kind === "tool" ? a.tool : a.kind), ["add_item_to_cart", "message"]);
  const menu: any = shown.messages.find(m => m.type === "interactive");
  assert.equal(menu.interactive.type, "button");
  assert.deepEqual(menu.interactive.action.buttons.map((b: any) => b.reply.title), ["🛒 Adicionar", "Menu principal"]);
  assert.deepEqual(shown.selections[menu.interactive.action.buttons[0].reply.id], source.primaryAction!.action);
  assert.deepEqual(resolveMetaStoreTextAction("Menu principal", { ...s, view }), { kind: "message", message: "/atalhos" });
  assert.notEqual(menu.interactive.action.buttons[0].reply.id, (presentMetaUi(view, "next").messages.find(m => m.type === "interactive") as any).interactive.action.buttons[0].reply.id);
});

test("public reviews keep their own filters and the same product's purchase, never global navigation", () => {
  const s = state(), source = details(s);
  const reviews = buildMetaUiView({ agentMessage: "Avaliações", quickReplies: ["Ver Produtos", "Ver Carrinho", "Categorias"], state: s,
    blocks: [{ type: "reviews", data: { productId: "p", productName: "Mouse", totalReviews: 0, averageRating: 0, reviews: [] } }] });
  const view = withMetaCartNavigation(withMetaProductNavigation(reviews, source, s), true);
  const shown = presentMetaUi(view, "reviews", 0, { canGoBack: true });
  assert(shown.numericSelections.some(a => a.kind === "tool" && a.tool === "get_reviews"));
  assert(shown.numericSelections.some(a => a.kind === "tool" && a.tool === "add_item_to_cart" && a.args.variantId === "v"));
  assert(!shown.numericSelections.some(a => a.kind === "back" || a.kind === "tool" && ["search_products", "get_cart", "checkout", "list_categories"].includes(a.tool)));
  assert(shown.numericSelections.some(a => a.kind === "message" && a.message === "/atalhos"));
});

test("different products, pending variants/options, stock and checkout cannot inherit an add", () => {
  const s = state();
  const views = [details(s, { variants: [{ id: "a", stock: 2 }, { id: "b", stock: 2 }] }), details(s, { inStock: false }),
    details(s, { optionGroups: [{ id: "g", name: "Tamanho", required: true, items: [{ id: "large", name: "Grande" }] }] })];
  for (const source of views) {
    const v = withMetaProductNavigation(surface(), source, s, "p");
    assert(!v.choices.some(c => c.action.kind === "tool" && c.action.tool === "add_item_to_cart"));
    assert(v.choices.some(c => c.action.kind === "tool" && c.action.tool === "get_product_details" && c.action.args.productId === "p"));
  }
  const other = withMetaProductNavigation(surface([{ type: "reviews", data: { productId: "other" } }]), details(s), s);
  assert(!other.choices.some(c => c.action.kind === "tool" && c.action.tool === "add_item_to_cart"));
  assert.equal(withMetaProductNavigation(surface(), details(s), { ...s, stage: "checkout" }, "p").productContext, undefined);
  const changed = withMetaProductNavigation(surface(), details(s), { ...s, selectedProductId: "p", selectedVariantId: "changed" }, "p");
  assert(!changed.choices.some(c => c.action.kind === "tool" && c.action.tool === "add_item_to_cart"));
});

test("offer recommendation and its reviews retain the quoted acceptance action and reject expired offers", () => {
  const s = state();s.postCartOffer = { id: "offer", productId: "p", name: "Mouse", cartId: "cart", status: "pending", expiresAt: Date.now() + 60000 } as any;
  const source = buildMetaUiView({ agentMessage: "Recomendação", quickReplies: [], state: s, blocks: [{ type: "post_cart_offer", data: { offerId: "offer", productId: "p", name: "Mouse", priceCents: 6000 } }] });
  assert.equal(source.primaryAction?.action.kind === "tool" && source.primaryAction.action.tool, "accept_cross_sell_offer");
  const view = withMetaProductNavigation(surface([{ type: "reviews", data: { productId: "p", productName: "Mouse" } }]), source, s);
  assert.equal(view.productContext?.offerId, "offer");
  assert(view.choices.some(c => c.action.kind === "tool" && c.action.tool === "accept_cross_sell_offer" && c.action.args.offerId === "offer"));
  for (const offer of [{ ...s.postCartOffer!, status: "accepted" }, { ...s.postCartOffer!, expiresAt: 1 }, { ...s.postCartOffer!, cartId: "foreign" }]) {
    const result = withMetaProductNavigation(surface(), source, { ...s, postCartOffer: offer as any }, "p");
    assert(!result.primaryAction);
    assert(!result.choices.some(c => c.action.kind === "tool" && ["add_item_to_cart", "accept_cross_sell_offer"].includes(c.action.tool)));
  }
});
