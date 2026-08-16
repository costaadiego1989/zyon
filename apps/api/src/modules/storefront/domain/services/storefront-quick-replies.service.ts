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
  | "post_purchase" | "support";

/**
 * Detect conversation stage from the last tool that was executed.
 * Maps tool names to semantic stages for better UX flows.
 */
export function detectStoreStage(lastToolUsed: string | null | undefined, context?: { cartItemCount?: number }): StoreStage {
  if (!lastToolUsed) return "welcome";

  const toolToStage: Record<string, StoreStage> = {
    search_products: "browsing",
    list_products: "browsing",
    get_product: "product_detail",
    get_product_details: "product_detail",
    add_item_to_cart: "added_to_cart",
    remove_cart_item: "added_to_cart",
    update_cart_item: "added_to_cart",
    get_cart: context?.cartItemCount ? "added_to_cart" : "welcome",
    quote_shipping: "added_to_cart",
    list_categories: "categories",
    get_reviews: "reviews",
    create_review: "reviews",
    get_wishlist: "wishlist",
    add_to_wishlist: "wishlist",
    compare_products: "compare",
    track_order: "post_purchase",
    get_order_status: "post_purchase",
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
  shippingOptions?: StorefrontShippingOption[]
): string[] {
  const cfg = config ?? DEFAULT_STORE_QUICK_REPLIES;
  const stage = detectStoreStage(lastToolUsed, { cartItemCount: cartState?.itemCount });

  // Find stage configuration
  const stageConfig = cfg.stages.find(s => s.stage === stage);
  if (!stageConfig) return cfg.fallback.slice(0, 5);

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
