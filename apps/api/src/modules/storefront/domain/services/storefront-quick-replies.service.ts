/**
 * Storefront quick replies — stage-based and context-intelligent suggestions.
 *
 * Generates deterministic quick-reply suggestions based on conversation stage,
 * last tool used, and current context (cart state, shipping options).
 * Max 8 replies per stage; always deterministic, never LLM-generated.
 */

import type { StoreQuickRepliesConfig } from "@zyon/shared-types";
import { DEFAULT_STORE_QUICK_REPLIES } from "../defaults/store-quick-replies.defaults.js";

export interface StorefrontCartState {
  items: Array<{ variantId: string; name: string; quantity: number }>;
  total: number;
  itemCount: number;
  couponCode?: string | null;
}

export interface StorefrontShippingOption {
  carrier: string;
  name: string;
  price: number;
  days: number;
}

export type StoreStage =
  | "welcome" | "browsing" | "filter" | "categories"
  | "product_detail" | "more_info" | "reviews" | "review_card"
  | "questions" | "compare" | "wishlist" | "added_to_cart"
  | "promotions"
  | "post_purchase" | "support";

/**
 * Detect conversation stage from the last tool that was executed.
 * Maps tool names to semantic stages for better UX flows.
 */
export function detectStoreStage(lastToolUsed: string | null | undefined, context?: { cartItemCount?: number; userMessage?: string }): StoreStage {
  // If no tool was called, try to infer stage from user message
  if (!lastToolUsed && context?.userMessage) {
    const msg = context.userMessage.toLowerCase().trim();
    if (/adicionar|add.*carrin|comprar/i.test(msg)) return "added_to_cart";
    if (/filtrar|filtro|ordenar|por pre[cç]o|avalia[cç][aã]o|mais vendidos|novidades|frete gr[aá]tis|desconto|limpar filtro/i.test(msg)) return "filter";
    if (/categorias?|segmento/i.test(msg)) return "categories";
    if (/rastrear|tracking|nota fiscal|cancelar pedido/i.test(msg)) return "post_purchase";
    if (/suporte|ajuda|falar com|humano|problema|reportar/i.test(msg)) return "support";
    if (/troca|devolu[cç][aã]o|garantia|pol[ií]tica/i.test(msg)) return "support";
    if (/detalh|saber mais|informa[cç]|especifica/i.test(msg)) return "product_detail";
    if (/avalia[cç]|review/i.test(msg)) return "reviews";
    if (/d[uú]vida|pergunt/i.test(msg)) return "questions";
    if (/compar/i.test(msg)) return "compare";
    if (/desejo|wishlist/i.test(msg)) return "wishlist";
    if (/prazo|entrega|frete|cep|envio/i.test(msg)) return "browsing";
    if (/ver produto|buscar|encontrar|produto|oferta|promo/i.test(msg)) return "browsing";
    if (/meus dados|perfil|conta/i.test(msg)) return "support";
    return "welcome";
  }
  if (!lastToolUsed) return "welcome";

  const toolToStage: Record<string, StoreStage> = {
    // Browsing / catalog
    search_products: "browsing",
    list_products: "browsing",
    get_daily_deals: "browsing",
    get_similar_products: "browsing",
    // Product detail
    get_product: "product_detail",
    get_product_details: "product_detail",
    get_product_availability: "product_detail",
    // Reviews
    get_reviews: "reviews",
    create_review: "reviews",
    // Questions
    get_product_questions: "questions",
    create_question: "questions",
    // Comparison
    compare_products: "compare",
    // Wishlist
    get_wishlist: "wishlist",
    add_to_wishlist: "wishlist",
    remove_from_wishlist: "wishlist",
    // Cart & checkout
    add_item_to_cart: "added_to_cart",
    remove_cart_item: "added_to_cart",
    update_cart_item: "added_to_cart",
    clear_cart: "added_to_cart",
    get_cart: context?.cartItemCount ? "added_to_cart" : "welcome",
    quote_shipping: "added_to_cart",
    apply_coupon: "added_to_cart",
    remove_coupon: "added_to_cart",
    list_promotions: "promotions",
    create_checkout_session: "added_to_cart",
    // Categories
    list_categories: "categories",
    // Post-purchase
    track_order: "post_purchase",
    get_order_status: "post_purchase",
    get_invoice: "post_purchase",
    cancel_order: "post_purchase",
    // Support
    get_store_policies: "support",
    get_buyer_profile: "support",
    get_faq: "support",
    escalate_to_human: "support",
  };

  return toolToStage[lastToolUsed] ?? "welcome";
}

/**
 * Generate smart quick-reply suggestions based on stage, tool context, and merchant config.
 *
 * @param lastToolUsed Name of the tool that was just executed
 * @param config Merchant's custom quick replies config (loaded from storeSettings)
 * @param cartState Current cart state (items, total, coupon)
 * @param shippingOptions Available shipping options (if quote_shipping was called)
 * @returns Array of quick-reply strings matching the stage
 */
export function storefrontQuickReplies(
  lastToolUsed: string | null | undefined,
  config?: StoreQuickRepliesConfig | null,
  cartState?: StorefrontCartState,
  shippingOptions?: StorefrontShippingOption[],
  userMessage?: string,
  listedCouponCodes?: string[]
): string[] {
  const cfg = config ?? DEFAULT_STORE_QUICK_REPLIES;
  const stage = detectStoreStage(lastToolUsed, { cartItemCount: cartState?.itemCount, userMessage });

  // For shipping stage, inject dynamic carrier options if available
  if (lastToolUsed === "quote_shipping" && shippingOptions?.length) {
    return shippingOptions
      .map(o => {
        const days = o.days ? ` (${o.days} dias)` : "";
        const price = formatMoney(o.price);
        return `${o.name}${days} - ${price}`;
      })
      .slice(0, 5);
  }

  // Promotions stage: offer to APPLY the listed coupon(s) — the previous mapping
  // fell through to generic cart replies ("Produtos Semelhantes" etc.) that had
  // nothing to do with the coupon just shown. When a coupon isn't yet applied,
  // lead with a concrete "Aplicar cupom <CODE>" (parsed deterministically on send).
  if (stage === "promotions") {
    const codes = (listedCouponCodes ?? []).filter(Boolean);
    const notApplied = codes.filter((c) => c.toUpperCase() !== (cartState?.couponCode ?? "").toUpperCase());
    const replies = notApplied.slice(0, 2).map((c) => `Aplicar cupom ${c}`);
    replies.push("Ver Carrinho");
    if ((cartState?.itemCount ?? 0) > 0) replies.push("Finalizar Compra");
    else replies.push("Ver Produtos");
    return [...new Set(replies)].slice(0, 5);
  }

  // Find stage configuration
  const stageConfig = cfg.stages.find(s => s.stage === stage);
  if (!stageConfig) return cfg.fallback.slice(0, 5);

  return stageConfig.replies.slice(0, 8);
}

/**
 * Format price in BRL currency for display.
 * Quick helper; production code should use centralized formatting.
 */
function formatMoney(valueCents: number): string {
  const valueReal = valueCents / 100;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valueReal);
}

// Legacy adapter for backward compatibility (deprecated)
export function storefrontQuickRepliesLegacy(
  lastToolUsed: string | undefined,
  cartState?: StorefrontCartState,
  shippingOptions?: StorefrontShippingOption[]
): string[] {
  return storefrontQuickReplies(lastToolUsed, null, cartState, shippingOptions);
}
