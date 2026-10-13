import type { StoreUiAction, WhatsAppConversationState } from "./meta-ui.types.js";

/** Resolve built-in store shortcuts; custom questions keep the shared agent. */
export function metaStoreQuickReplyAction(label: string, state: WhatsAppConversationState): StoreUiAction | undefined {
  if (state.stage !== "store") return /^ver carrinho$/i.test(label.trim()) ? { kind: "tool", tool: "get_cart", args: {} } : undefined;
  const key = label.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const tool = (name: string, args: Record<string, unknown> = {}): StoreUiAction => ({ kind: "tool", tool: name, args });
  if (["ver produtos", "continuar comprando"].includes(key)) return tool("search_products", { query: "*" });
  if (key === "categorias") return tool("list_categories");
  if (key === "ver carrinho") return tool("get_cart");
  if (key === "finalizar compra") return tool("checkout");
  if (key === "ofertas") return tool("get_daily_deals");
  if (key === "lista de desejos") return tool("get_wishlist");
  if (!state.selectedProductId) return;
  const args = { productId: state.selectedProductId };
  if (["mais informacoes", "adicionar ao carrinho"].includes(key)) return tool("get_product_details", args);
  if (key === "ver avaliacoes") return tool("get_reviews", args);
  if (key === "produtos semelhantes") return tool("get_similar_products", args);
  if (key === "comparar") return tool("compare_products", args);
}

/** A typed label may reuse only one action from the current persisted view. */
export function resolveMetaStoreTextAction(message: string, state: WhatsAppConversationState): StoreUiAction | undefined {
  if (state.stage === "checkout" && !state.expectsFreeInput && /^(trocar pagamento|usar cupom|confirmar troca|manter pagamento)$/i.test(message.trim())) {
    const matches = state.view?.choices.filter(c => c.label.trim().toLocaleLowerCase("pt-BR") === message.trim().toLocaleLowerCase("pt-BR")) ?? [];
    return matches.length === 1 ? matches[0].action : undefined;
  }
  if (state.expectsFreeInput || state.stage !== "store") return;
  const sameLabel = state.view?.choices.filter(c => c.label.trim().toLocaleLowerCase("pt-BR") === message.trim().toLocaleLowerCase("pt-BR")) ?? [];
  if (sameLabel.length === 1) return sameLabel[0].action;
  return metaStoreQuickReplyAction(message, state);
}
