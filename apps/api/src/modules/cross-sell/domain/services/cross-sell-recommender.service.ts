import type { Cart } from "@zyon/shared-types";
import type { CrossSellPromotionEntity } from "../entities/cross-sell-promotion.entity.js";
import { isPromotionEligible } from "../policies/eligibility.policy.js";

export type RankedSuggestion = {
  promo_id: string;
  ranked_items: string[];
  discount_percent: number;
};

/**
 * Optional purchase-history signals that bias the cross-sell ranking.
 * - `top_categories`: buyer's most-purchased categories — boost promotions whose
 *   `category_in_cart` trigger overlaps with these.
 * - `recent_skus`: SKUs the buyer bought recently — boost promotions whose
 *   `recommended_skus` overlap with these.
 *
 * Omitted (undefined) means the recommender has no history context — the
 * ranking falls back to discount-only.
 */
export type PurchaseHistoryBias = {
  top_categories?: string[];
  recent_skus?: string[];
};

export function rankEligiblePromotions(
  promotions: CrossSellPromotionEntity[],
  cart: Cart,
  history?: PurchaseHistoryBias
): RankedSuggestion[] {
  const cartSkus = new Set(cart.items.map((i) => i.sku));
  const topCategories = new Set((history?.top_categories ?? []).map((c) => c.toLowerCase()));
  const recentSkus = new Set(history?.recent_skus ?? []);

  return promotions
    .filter((p) => isPromotionEligible(p, cart))
    .map((p) => {
      const snap = p.snapshot();
      const newSkus = snap.recommended_skus.filter((sku) => !cartSkus.has(sku));

      // History bias: count signals (0 = no history, 1 = category match, 2 = sku match).
      // Each match gets a small additive boost so it nudges ranking without
      // overriding a strictly better discount.
      let historyBoost = 0;
      const triggerCats = (p.snapshot().trigger as { category_in_cart?: string[] } | undefined)?.category_in_cart ?? [];
      if (topCategories.size > 0 && triggerCats.some((c) => topCategories.has(c.toLowerCase()))) {
        historyBoost += 1;
      }
      if (recentSkus.size > 0 && newSkus.some((sku) => recentSkus.has(sku))) {
        historyBoost += 2;
      }

      return {
        promo_id: snap.id,
        ranked_items: newSkus,
        discount_percent: snap.discount_percent,
        history_boost: historyBoost
      };
    })
    .sort((a, b) => {
      // Primary: discount desc. Secondary: history boost desc.
      if (b.discount_percent !== a.discount_percent) return b.discount_percent - a.discount_percent;
      return (b as any).history_boost - (a as any).history_boost;
    })
    .map(({ promo_id, ranked_items, discount_percent }) => ({
      promo_id,
      ranked_items,
      discount_percent
    }));
}
