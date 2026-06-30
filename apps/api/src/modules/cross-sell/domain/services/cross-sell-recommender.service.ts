import type { Cart } from "@zyon/shared-types";
import type { CrossSellPromotionEntity } from "../entities/cross-sell-promotion.entity.js";
import { isPromotionEligible } from "../policies/eligibility.policy.js";

export type RankedSuggestion = {
  promo_id: string;
  ranked_items: string[];
  discount_percent: number;
};

export function rankEligiblePromotions(promotions: CrossSellPromotionEntity[], cart: Cart): RankedSuggestion[] {
  const cartSkus = new Set(cart.items.map((i) => i.sku));
  return promotions
    .filter((p) => isPromotionEligible(p, cart))
    .map((p) => {
      const snap = p.snapshot();
      const newSkus = snap.recommended_skus.filter((sku) => !cartSkus.has(sku));
      return { promo_id: snap.id, ranked_items: newSkus, discount_percent: snap.discount_percent };
    })
    .sort((a, b) => b.discount_percent - a.discount_percent);
}
