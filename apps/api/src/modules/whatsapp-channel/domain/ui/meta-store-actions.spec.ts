import test from "node:test";
import assert from "node:assert/strict";
import { buildMetaUiView } from "./meta-ui-renderer.js";
import { metaStoreQuickReplyAction, resolveMetaStoreTextAction } from "./meta-store-actions.js";
import type { WhatsAppConversationState } from "./meta-ui.types.js";

const state = (): WhatsAppConversationState => ({ version: 1, conversationId: "conversation", stage: "store", history: [], revision: "turn", page: 0, previousViews: [], selectedProductId: "product" });

for (const [label, tool] of [
  ["Ver Produtos", "search_products"], ["Continuar Comprando", "search_products"], ["Categorias", "list_categories"],
  ["Ver Carrinho", "get_cart"], ["Finalizar Compra", "checkout"], ["Ofertas", "get_daily_deals"],
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
