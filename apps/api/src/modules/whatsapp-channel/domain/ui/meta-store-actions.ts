import type { StoreUiAction, WhatsAppConversationState } from "./meta-ui.types.js";

/** Resolve built-in store shortcuts; custom questions keep the shared agent. */
export function metaStoreQuickReplyAction(label: string, state: WhatsAppConversationState): StoreUiAction | undefined {
  const key = label.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const tool = (name: string, args: Record<string, unknown> = {}): StoreUiAction => ({ kind: "tool", tool: name, args });
  if (["ver produtos", "continuar comprando"].includes(key)) return tool("search_products", { query: "*" });
  if (["encontrar produto", "encontrar um produto"].includes(key)) return { kind: "message", message: "Encontrar produto" };
  if (key === "ver carrinho") return tool("get_cart");
  if (["finalizar compra", "finalizar pedido", "continuar checkout"].includes(key)) return tool("checkout");
  if (state.stage !== "store") return;
  if (key === "limpar filtros") return tool("search_products", { query: "*" });
  if (key === "categorias") return tool("list_categories");
  if (["ofertas", "ofertas do dia", "categorias em promocao"].includes(key)) return tool("get_daily_deals");
  if (["lista de desejos", "ver lista"].includes(key)) return tool("get_wishlist");
  const wishlist = state.view?.blocks.find(block => block.type === "wishlist");
  if (wishlist) {
    const entries = (wishlist.data as { items?: Array<{ id?: string }> }).items ?? [];
    if (key === "compartilhar") return tool("get_wishlist", { share: true });
    if (key === "remover item" && entries.length === 1 && entries[0]?.id) return tool("remove_from_wishlist", { productId: entries[0].id });
    if (["mover para carrinho", "escolher para comprar"].includes(key)) return entries.length === 1 && entries[0]?.id
      ? tool("get_product_details", { productId: entries[0].id }) : tool("get_wishlist");
  }
  if (!state.selectedProductId) return;
  const args = { productId: state.selectedProductId };
  if (["mais informacoes", "adicionar ao carrinho"].includes(key)) return tool("get_product_details", args);
  if (key === "ver avaliacoes") return tool("get_reviews", args);
  if (key === "positivas") return tool("get_reviews", { ...args, filter: "positive" });
  if (key === "negativas") return tool("get_reviews", { ...args, filter: "negative" });
  if (key === "ordenar por recentes") return tool("get_reviews", { ...args, filter: "recent" });
  if (key === "ver respondidas") return tool("get_product_questions", { ...args, filter: "answered" });
  if (key === "minhas perguntas") return tool("get_product_questions", { ...args, filter: "mine" });
  if (key === "fazer pergunta") return tool("ask_product_question", args);
  if (key === "produtos semelhantes") return tool("get_similar_products", args);
  if (key === "comparar") return tool("compare_products", args);
}

/** A typed label may reuse only one action from the current persisted view. */
export function resolveMetaStoreTextAction(message: string, state: WhatsAppConversationState): StoreUiAction | undefined {
  if (/^(ver produtos|encontrar produto|ver carrinho|finalizar compra|finalizar pedido|continuar checkout)$/i.test(message.trim())) return metaStoreQuickReplyAction(message, state);
  if (state.stage === "checkout" && !state.expectsFreeInput && /^(trocar pagamento|usar cupom|confirmar troca|manter pagamento)$/i.test(message.trim())) {
    const matches = state.view?.choices.filter(c => c.label.trim().toLocaleLowerCase("pt-BR") === message.trim().toLocaleLowerCase("pt-BR")) ?? [];
    return matches.length === 1 ? matches[0].action : undefined;
  }
  if (state.stage === "checkout" && !state.expectsFreeInput && /^(ver carrinho|continuar comprando|ver produtos)$/i.test(message.trim())) return metaStoreQuickReplyAction(message, state);
  if (state.expectsFreeInput || state.stage !== "store") return;
  // A whole typed coupon command is the text equivalent of a native coupon
  // control. No cart/customer IDs come from the message. Checkout fields keep
  // their existing fingerprint-bound entry flow instead.
  const coupon = message.trim().match(/^(?:aplicar|usar)\s+cupom\s+([a-z0-9][a-z0-9._-]{2,31})$/i);
  if (coupon) return { kind: "tool", tool: "apply_coupon", args: { couponCode: coupon[1]!.toUpperCase() } };
  if (/^outras op[cç][oõ]es$/i.test(message.trim()) && state.view &&
    !state.view.blocks.some(block => block.type === "product_card") &&
    state.view.blocks.some(block => ["product_carousel", "marketplace_products", "wishlist", "cross_sell"].includes(block.type))) return { kind: "catalog_options" };
  const sameLabel = state.view?.choices.filter(c => c.label.trim().toLocaleLowerCase("pt-BR") === message.trim().toLocaleLowerCase("pt-BR")) ?? [];
  if (sameLabel.length === 1) return sameLabel[0].action;
  return metaStoreQuickReplyAction(message, state);
}
