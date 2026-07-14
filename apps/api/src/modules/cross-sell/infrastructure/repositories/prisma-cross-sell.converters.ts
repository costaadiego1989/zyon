import type { CrossSellPromotion as PrismaPromo, CrossSellSuggestion as PrismaSuggestion } from "@prisma/client";
import { CrossSellPromotionEntity, type CrossSellPromotionSnapshot } from "../../domain/entities/cross-sell-promotion.entity.js";
import { CrossSellSuggestionEntity, type CrossSellSuggestionSnapshot } from "../../domain/entities/cross-sell-suggestion.entity.js";

export function toPromoEntity(row: PrismaPromo): CrossSellPromotionEntity {
  const snap: CrossSellPromotionSnapshot = {
    id: row.id,
    merchant_id: row.merchantId,
    name: row.name,
    trigger: row.trigger as Record<string, unknown>,
    recommended_skus: row.recommendedSkus,
    discount_percent: row.discountPercent,
    max_discount_percent: row.maxDiscountPercent,
    status: row.status as "active" | "archived",
    starts_at: row.startsAt.toISOString(),
    ends_at: row.endsAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString()
  };
  return CrossSellPromotionEntity.rehydrate(snap);
}

export function toPromoCreateInput(entity: CrossSellPromotionEntity) {
  const snap = entity.snapshot();
  return {
    id: snap.id,
    merchantId: snap.merchant_id,
    name: snap.name,
    trigger: snap.trigger as any,
    recommendedSkus: snap.recommended_skus,
    discountPercent: snap.discount_percent,
    maxDiscountPercent: snap.max_discount_percent,
    status: snap.status,
    startsAt: new Date(snap.starts_at),
    endsAt: snap.ends_at ? new Date(snap.ends_at) : null,
  };
}

export function toPromoUpdateInput(entity: CrossSellPromotionEntity) {
  const snap = entity.snapshot();
  return {
    name: snap.name,
    trigger: snap.trigger as any,
    recommendedSkus: snap.recommended_skus,
    discountPercent: snap.discount_percent,
    maxDiscountPercent: snap.max_discount_percent,
    status: snap.status,
    startsAt: new Date(snap.starts_at),
    endsAt: snap.ends_at ? new Date(snap.ends_at) : null,
  };
}

export function toSuggestionEntity(row: PrismaSuggestion): CrossSellSuggestionEntity {
  const snap: CrossSellSuggestionSnapshot = {
    id: row.id,
    merchant_id: row.merchantId,
    session_id: row.sessionId,
    promo_id: row.promoId,
    ranked_items: row.rankedItems,
    agent_copy: row.agentCopy,
    computed_discount: row.computedDiscount,
    status: row.status as "pending" | "accepted" | "declined",
    suggested_at: row.suggestedAt.toISOString(),
    resolved_at: row.resolvedAt?.toISOString() ?? null
  };
  return CrossSellSuggestionEntity.rehydrate(snap);
}

export function toSuggestionCreateInput(entity: CrossSellSuggestionEntity) {
  const snap = entity.snapshot();
  return {
    id: snap.id,
    merchantId: snap.merchant_id,
    sessionId: snap.session_id,
    promoId: snap.promo_id,
    rankedItems: snap.ranked_items,
    agentCopy: snap.agent_copy,
    computedDiscount: snap.computed_discount,
    status: snap.status,
    suggestedAt: new Date(snap.suggested_at),
    resolvedAt: snap.resolved_at ? new Date(snap.resolved_at) : null
  };
}

export function toSuggestionUpdateInput(entity: CrossSellSuggestionEntity) {
  const snap = entity.snapshot();
  return {
    status: snap.status,
    resolvedAt: snap.resolved_at ? new Date(snap.resolved_at) : null
  };
}
