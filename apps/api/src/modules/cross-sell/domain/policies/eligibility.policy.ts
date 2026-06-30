import type { Cart } from "@zyon/shared-types";
import type { CrossSellPromotionEntity } from "../entities/cross-sell-promotion.entity.js";

export function isPromotionEligible(promotion: CrossSellPromotionEntity, cart: Cart): boolean {
  const snap = promotion.snapshot();
  const { trigger } = snap;
  const now = new Date();

  if (!promotion.isActive()) return false;
  if (new Date(snap.starts_at) > now) return false;
  if (snap.ends_at && new Date(snap.ends_at) < now) return false;

  const cartSkus = new Set(cart.items.map((i) => i.sku));
  const cartCategories = new Set(cart.items.map((i) => i.category).filter(Boolean));

  if (trigger.sku_in_cart?.length) {
    const matches = trigger.sku_in_cart.some((sku) => cartSkus.has(sku));
    if (!matches) return false;
  }

  if (trigger.category_in_cart?.length) {
    const matches = trigger.category_in_cart.some((cat) => cartCategories.has(cat));
    if (!matches) return false;
  }

  if (trigger.cart_total_above !== undefined && cart.total <= trigger.cart_total_above) {
    return false;
  }

  // Exclude already-carted recommended skus from being suggested
  const hasNewItems = snap.recommended_skus.some((sku) => !cartSkus.has(sku));
  return hasNewItems;
}
