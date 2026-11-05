import type { MetaUiView, StoreUiAction, WhatsAppConversationState } from "./meta-ui.types.js";

function references(view: MetaUiView, actions?: StoreUiAction[]): Array<{ id: string; name: string }> {
  const shown = actions ?? view.choices.map(choice => choice.action);
  const ids = [...new Set(shown.flatMap(action => action.kind === "tool" && action.tool === "get_product_details"
    && typeof action.args.productId === "string" ? [action.args.productId] : []))];
  // An oversized list is not permission to arbitrarily choose its first pair.
  if (!ids.length || ids.length > 5) return [];
  const products = view.blocks.flatMap(block => {
    const data = block.data as Record<string, any>;
    return block.type === "product_card" ? [data]
      : ["product_carousel", "marketplace_products", "cross_sell", "wishlist", "product_comparison"].includes(block.type)
        ? Array.isArray(data.products ?? data.items) ? data.products ?? data.items : [] : [];
  });
  return ids.flatMap(id => {
    const product = products.find((item: any) => (item.id ?? item.productId) === id);
    return product && typeof product.name === "string" ? [{ id, name: product.name.slice(0, 500) }] : [];
  });
}

/** Identity hints from the server-owned visible menu; prices and availability
 * are deliberately absent and must be reread by the comparison tool. */
export function withMetaProductReferences(state: WhatsAppConversationState): WhatsAppConversationState["history"] {
  const current = state.view ? references(state.view, state.numericSelections) : [];
  const previous = state.previousViews.at(-1);
  const products = current.length ? current : previous ? references(previous) : [];
  if (!products.length) return state.history;
  const hint = `\n\nProdutos apresentados nesta página (somente identidade): ${JSON.stringify(products)}`;
  const history = state.history.map(message => ({ ...message }));
  let index = history.length - 1;
  while (index >= 0 && history[index]!.role !== "assistant") index--;
  if (index >= 0) history[index]!.content += hint;
  else history.push({ role: "assistant", content: hint.trim() });
  return history;
}
