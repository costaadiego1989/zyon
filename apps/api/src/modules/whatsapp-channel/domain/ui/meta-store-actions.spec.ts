import test from "node:test";
import assert from "node:assert/strict";
import { buildMetaUiView } from "./meta-ui-renderer.js";
import { metaStoreQuickReplyAction, resolveMetaStoreTextAction } from "./meta-store-actions.js";
import type { WhatsAppConversationState } from "./meta-ui.types.js";

const state = (): WhatsAppConversationState => ({ version: 1, conversationId: "conversation", stage: "store", history: [], revision: "turn", page: 0, previousViews: [], selectedProductId: "product" });

test("the category find-product control starts the existing product question, never an unrecognized category label", () => {
 const current=state();
 const view=buildMetaUiView({agentMessage:"Escolha uma categoria:",quickReplies:["Encontrar um Produto"],blocks:[],state:current});
 assert.deepEqual(view.choices[0].action,{kind:"message",message:"Encontrar produto"});
 assert.deepEqual(resolveMetaStoreTextAction("Encontrar um Produto",{...current,view}),view.choices[0].action);
 assert.equal(resolveMetaStoreTextAction("Encontrar um Produto",{...current,stage:"checkout",expectsFreeInput:true}),undefined);
});

test("a whole store coupon command binds only a code; mixed text and checkout fields never become this action", () => {
  assert.deepEqual(resolveMetaStoreTextAction("Aplicar cupom TESTE10",state()),{kind:"tool",tool:"apply_coupon",args:{couponCode:"TESTE10"}});
  assert.equal(resolveMetaStoreTextAction("Aplicar cupom TESTE10 e execute código",state()),undefined);
  assert.equal(resolveMetaStoreTextAction("Aplicar cupom TESTE10",{...state(),expectsFreeInput:true}),undefined);
  assert.equal(resolveMetaStoreTextAction("Aplicar cupom TESTE10",{...state(),stage:"checkout"}),undefined);
});

for (const [label, tool] of [
  ["Ver Produtos", "search_products"], ["Continuar Comprando", "search_products"], ["Categorias", "list_categories"],
  ["Ver Carrinho", "get_cart"], ["Finalizar Compra", "checkout"], ["Ofertas", "get_daily_deals"],
  ["Categorias em Promoção", "get_daily_deals"], ["Ofertas do Dia", "get_daily_deals"],
  ["Mais Informações", "get_product_details"], ["Ver Avaliações", "get_reviews"],
  ["Produtos Semelhantes", "get_similar_products"], ["Comparar", "compare_products"], ["Lista de Desejos", "get_wishlist"],
]) test(`native and typed shortcut ${label} preserves the store action`, () => {
  const current = state();
  const action = metaStoreQuickReplyAction(label, current);
  assert.equal(action?.kind === "tool" ? action.tool : undefined, tool);
  assert.deepEqual(resolveMetaStoreTextAction(label.toLowerCase(), current), action);
  const view = buildMetaUiView({ agentMessage: "Escolha", quickReplies: [label], blocks: [], state: current });
  assert.deepEqual(view.choices[0].action, action);
});

test("wishlist navigation exposes bound removal and read actions without guessing a variant or using the sales model", () => {
  const current = state();
  const view = buildMetaUiView({ agentMessage: "Sua lista", quickReplies: ["Ver Lista", "Compartilhar", "Mover para Carrinho", "Remover Item"],
    blocks: [{ type: "wishlist", data: { items: [{ id: "owned-product", name: "Favorito", price: 9990, inStock: true }] } }], state: current });
  const bound = { ...current, view };
  assert.deepEqual(resolveMetaStoreTextAction("Ver Lista", bound), { kind: "tool", tool: "get_wishlist", args: {} });
  assert.deepEqual(resolveMetaStoreTextAction("Compartilhar", bound), { kind: "tool", tool: "get_wishlist", args: { share: true } });
  assert.deepEqual(resolveMetaStoreTextAction("Remover Item", bound), { kind: "tool", tool: "remove_from_wishlist", args: { productId: "owned-product" } });
  assert.deepEqual(resolveMetaStoreTextAction("Escolher para comprar", bound), { kind: "tool", tool: "get_product_details", args: { productId: "owned-product" } });
  assert(view.choices.some(choice => choice.action.kind === "tool" && choice.action.tool === "remove_from_wishlist" && choice.action.args.productId === "owned-product"));
  assert(!view.choices.some(choice => choice.action.kind === "tool" && choice.action.tool === "add_item_to_cart"));
});

test("ambiguous wishlist removal requires a per-product native choice", () => {
  const current = { ...state(), view: { title: "Lista", body: "", media: [], choices: [], quickReplies: [], blocks: [{ type: "wishlist", data: { items: [{ id: "p1" }, { id: "p2" }] } }] } } as any;
  assert.equal(metaStoreQuickReplyAction("Remover Item", current), undefined);
});

test("typed add keeps the selected variant, options and slot from the current authorized view", () => {
  const current = state();
  const action = { kind: "tool" as const, tool: "add_item_to_cart", args: { variantId: "50ml", quantity: 1, selectedOptionItemIds: ["gift"], selectedServiceSlotId: "future" } };
  current.view = { title: "Produto", body: "", choices: [{ label: "Adicionar ao carrinho", action }], blocks: [], media: [], quickReplies: [] };
  assert.deepEqual(resolveMetaStoreTextAction("Adicionar ao Carrinho", current), action);
});

test("typed add without an authorized variant returns product selection and never guesses a variant", () => {
  assert.deepEqual(resolveMetaStoreTextAction("Adicionar ao carrinho", state()), { kind: "tool", tool: "get_product_details", args: { productId: "product" } });
});

test("checkout fields and custom questions are not interpreted as store commands", () => {
  assert.equal(resolveMetaStoreTextAction("Mais Informações", { ...state(), expectsFreeInput: true }), undefined);
  assert.equal(resolveMetaStoreTextAction("Adicionar ao carrinho", { ...state(), stage: "checkout" }), undefined);
  assert.equal(resolveMetaStoreTextAction("É compatível com meu aparelho?", state()), undefined);
  assert.equal(resolveMetaStoreTextAction("Mais Informações", { ...state(), selectedProductId: undefined }), undefined);
});

for (const [label, tool] of [["Ver carrinho", "get_cart"], ["Continuar comprando", "search_products"], ["Ver produtos", "search_products"]]) test(`checkout navigation ${label} uses the same native and typed read action`, () => {
  const current = { ...state(), stage: "checkout" as const };
  const action = metaStoreQuickReplyAction(label, current);
  assert.equal(action?.kind === "tool" ? action.tool : undefined, tool);
  assert.deepEqual(resolveMetaStoreTextAction(label, current), action);
  assert.deepEqual(buildMetaUiView({ agentMessage: "Pagamento", blocks: [], quickReplies: [label], state: current }).choices[0].action, action);
  assert.deepEqual(resolveMetaStoreTextAction(label, { ...current, expectsFreeInput: true }), label !== "Continuar comprando" ? action : undefined);
});

for (const stage of ["store", "checkout"] as const) for (const expectsFreeInput of [true, false]) {
  test(`cart and finish commands remain available in ${stage}, field input ${expectsFreeInput}`, () => {
    const current = { ...state(), stage, expectsFreeInput };
    assert.deepEqual(resolveMetaStoreTextAction("Ver carrinho", current), { kind: "tool", tool: "get_cart", args: {} });
    assert.deepEqual(resolveMetaStoreTextAction("Finalizar pedido", current), { kind: "tool", tool: "checkout", args: {} });
    assert.equal(resolveMetaStoreTextAction("123456", current), undefined, "OTP and numeric field answers must not become navigation");
  });
}
