import type { CrossSellPromotionSnapshot } from '../../../../cross-sell/domain/entities/cross-sell-promotion.entity.js';
import type { CrossSellSuggestionSnapshot } from '../../../../cross-sell/domain/entities/cross-sell-suggestion.entity.js';

export class CrossSellEntityMapper {
  static toPromotionResponse(snapshot: CrossSellPromotionSnapshot) {
    return {
      id: snapshot.id,
      merchant_id: snapshot.merchant_id,
      name: snapshot.name,
      trigger: {
        sku_in_cart: snapshot.trigger.sku_in_cart ?? undefined,
        category_in_cart: snapshot.trigger.category_in_cart ?? undefined,
        cart_total_above: snapshot.trigger.cart_total_above ?? undefined,
      },
      recommended_skus: snapshot.recommended_skus,
      discount_percent: snapshot.discount_percent,
      max_discount_percent: snapshot.max_discount_percent,
      status: snapshot.status,
      starts_at: snapshot.starts_at,
      ends_at: snapshot.ends_at,
      created_at: snapshot.created_at,
      updated_at: snapshot.updated_at,
    };
  }

  static toEligibleResponse(snapshot: CrossSellSuggestionSnapshot) {
    return {
      suggestion_id: snapshot.id,
      promotion_id: snapshot.promo_id,
      recommended_skus: snapshot.ranked_items,
      discount_percent: snapshot.computed_discount,
      status: snapshot.status,
      suggested_at: snapshot.suggested_at,
    };
  }
}
