import type { MetaUiView, StoreUiAction } from "./meta-ui.types.js";

/** An older native menu may still open a public/read surface. It must never
 * authorize a cart, variant, option, identity or payment change. */
export function isMetaReadNavigation(action: StoreUiAction): boolean {
  if (["page", "back", "menu"].includes(action.kind)) return true;
  return action.kind === "tool" && ["search_products", "get_product_details", "list_categories", "get_reviews",
    "get_similar_products", "compare_products", "get_daily_deals", "get_cart", "get_wishlist",
    "show_content", "product_gallery", "media_page"].includes(action.tool);
}

export function refreshMetaReadView(view?: MetaUiView): StoreUiAction | undefined {
  const product = view?.blocks.find(block => block.type === "product_card");
  if (product) return { kind: "tool", tool: "get_product_details", args: { productId: (product.data as any).id } };
  const catalog = view?.blocks.find(block => block.type === "product_carousel");
  if (catalog) return { kind: "tool", tool: "search_products", args: { query: (catalog.data as any).query || "*", categoryId: (catalog.data as any).categoryId } };
  if (view?.blocks.some(block => block.type === "cart_summary")) return { kind: "tool", tool: "get_cart", args: {} };
}
