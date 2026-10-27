import type { MerchantRules } from "@zyon/shared-types";
import { evaluateCombinedDiscount } from "@zyon/rules-engine";
import { selectBestProductPromotion, allocatePromotionDiscountBudget } from "../../../catalog/domain/services/best-product-promotion.service.js";
import type { ProductPromotionRepositoryPort } from "../../../catalog/domain/ports/product-promotion-repository.port.js";
import type { StorefrontCart } from "../../domain/ports/storefront-cart.port.js";
import { toEngineCart } from "../../domain/services/cart-rules-engine.service.js";
import { commercialNotice } from "../../domain/services/commercial-notice.js";

export type ProductPromoMeta = Map<string, { originalPriceCents: number; discountPercent?: number; coupon?: boolean }>;
type PromoLine = Pick<StorefrontCart["items"][number], "variantId" | "selectedOptions" | "selectedServiceSlot">;
export interface PromotionPricingAuthority {
  rules: MerchantRules;
  costsByVariant: ReadonlyMap<string, number>;
}
const lineIdentity = (item: PromoLine) => JSON.stringify([
  item.variantId, JSON.stringify([item.variantId, (item.selectedOptions ?? []).map(option => option.itemId).sort()]),
  item.selectedServiceSlot?.slotId ?? null,
]);
// NUL cannot occur in a PostgreSQL text identifier, so a canonical line key can
// never collide with the legacy variant alias. These keys never leave the map.
const badgeKey = (item: PromoLine) => `\0storefront-cart-line:${lineIdentity(item)}`;
export function setProductPromoBadge(meta: ProductPromoMeta, lines: readonly PromoLine[], item: PromoLine, badge: NonNullable<ReturnType<ProductPromoMeta["get"]>>): void {
  if (lines.filter(line => line.variantId === item.variantId).length === 1) meta.set(item.variantId, badge);
  else { meta.delete(item.variantId); meta.set(badgeKey(item), badge); }
}
export function getProductPromoBadge(meta: ProductPromoMeta | undefined, item: PromoLine) {
  return meta?.get(badgeKey(item)) ?? meta?.get(item.variantId);
}

/** Project a SERVER-AUTHORED quote, never submitted cart fields. Persisted
 * prices remain original. Promotions and cart savings share one budget. */
export async function applyProductPromoPricing(
  promoRepo: Pick<ProductPromotionRepositoryPort, "findActiveBySku"> | undefined,
  merchantId: string,
  cart: StorefrontCart,
  authority?: PromotionPricingAuthority,
): Promise<ProductPromoMeta> {
  const meta: ProductPromoMeta = new Map();
  // Accepted provenance requires the transaction-bound reader, never the
  // automatic-product-only projector or a remembered promotional budget.
  if (cart.items.some(item => item.crossSellIntent !== undefined)) throw new Error("cross_sell_quote_review_required");
  if (!authority) {
    if (cart.discountBudget !== undefined || cart.discount > 0) throw new Error("discount_price_review_required");
    return meta;
  }
  if (cart.merchantId !== merchantId) throw new Error("discount_price_review_required");
  if (cart.discountBudget !== undefined) {
    // Preserve already-reduced units; only still-canonical lines may receive
    // current automatic promotion, within headroom AFTER saved P0 plus D.
    const originals = cart.items.map(item => item.pricingOriginalUnitPriceCents);
    if (originals.some((value, index) => !Number.isSafeInteger(value) || value! < cart.items[index]!.unitPriceCents)
      || cart.items.reduce((sum, item, index) => sum + originals[index]! * item.quantity, 0) !== cart.discountBudget.originalSubtotalCents) {
      throw new Error("discount_price_review_required");
    }
    const engineCart = toEngineCart(cart, authority.costsByVariant);
    engineCart.currentDiscount = cart.discount / 100;
    const decision = evaluateCombinedDiscount(engineCart, authority.rules, cart.discount);
    if (decision.kind !== "authorized") throw new Error("discount_price_review_required");
    const now = new Date();
    const chosen = await Promise.all(cart.items.map(async (item, index) => {
      const promotions = promoRepo && item.unitPriceCents === originals[index]
        ? await promoRepo.findActiveBySku(merchantId, item.variantId, now) : [];
      return selectBestProductPromotion({ merchantId, variantId: item.variantId, productId: item.productId,
        categoryId: item.categoryId, baseUnitPriceCents: item.unitPriceCents, promotions, now });
    }));
    const ordered = cart.items.map((item, index) => ({ index, identity: lineIdentity(item) }))
      .sort((a, b) => a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0);
    if (new Set(ordered.map(line => line.identity)).size !== ordered.length) throw new Error("discount_price_review_required");
    const keys = new Map(ordered.map((line, rank) => [line.index, String(rank).padStart(3, "0")]));
    const allocation = allocatePromotionDiscountBudget({ budgetCents: decision.remainingDiscountCents,
      lines: cart.items.map((item, index) => ({ key: keys.get(index)!, baseUnitPriceCents: item.unitPriceCents,
        requestedUnitDiscountCents: chosen[index]!.unitDiscountCents, quantity: item.quantity })) });
    const allocated = new Map(allocation.lines.map(line => [line.key, line]));
    const projected = structuredClone(cart);
    projected.items.forEach((item, index) => { item.unitPriceCents = allocated.get(keys.get(index)!)!.unitPriceCents; });
    projected.total -= allocation.promotionDiscountCents;
    projected.discountBudget = { ...cart.discountBudget, promotionDiscountCents: cart.discountBudget.promotionDiscountCents + allocation.promotionDiscountCents };
    const projectedEngine = toEngineCart(projected, authority.costsByVariant); projectedEngine.currentDiscount = cart.discount / 100;
    const confirmed = evaluateCombinedDiscount(projectedEngine, authority.rules, cart.discount);
    if (confirmed.kind !== "authorized") throw new Error("discount_price_review_required");
    projected.items.forEach((item, index) => {
      if (originals[index]! > item.unitPriceCents) setProductPromoBadge(meta, projected.items, item, { originalPriceCents: originals[index]!,
        discountPercent: (originals[index]! - item.unitPriceCents) / originals[index]! * 100 });
      else if (chosen[index]!.couponIds.length) setProductPromoBadge(meta, projected.items, item, { originalPriceCents: originals[index]!, coupon: true });
    });
    const wasUnavailable = cart.commercialNotices?.some(notice => notice.code === "discount_unavailable");
    const wasLimited = cart.commercialNotices?.some(notice => notice.code === "discount_limited");
    delete projected.commercialNotices;
    if (confirmed.totalDiscountCents > 0 && confirmed.remainingDiscountCents === 0) projected.commercialNotices = [commercialNotice("discount_limit_reached")];
    else if ((wasUnavailable || chosen.some(line => line.unitDiscountCents > 0)) && authority.rules.maxDiscountPercent === 0) projected.commercialNotices = [commercialNotice("discount_unavailable")];
    else if (wasLimited || allocation.limitApplied) projected.commercialNotices = [commercialNotice("discount_limited")];
    Object.assign(cart, projected);
    if (!projected.commercialNotices) delete cart.commercialNotices;
    return meta;
  }
  const base = structuredClone(cart);
  delete base.discountBudget;
  delete base.commercialNotices;
  base.total = base.items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
  const engineBase = toEngineCart(base, authority.costsByVariant);
  engineBase.currentDiscount = base.discount / 100;
  const original = evaluateCombinedDiscount(engineBase, authority.rules, base.discount);
  if (original.kind === "requires_review") throw new Error("discount_price_review_required");
  if (original.kind !== "authorized") {
    if (base.discount > 0) throw new Error("discount_price_review_required");
    cart.commercialNotices = [commercialNotice("benefit_conditions_not_met")];
    return meta;
  }
  const now = new Date();
  const chosen = await Promise.all(base.items.map(async item => {
    const promotions = promoRepo ? await promoRepo.findActiveBySku(merchantId, item.variantId, now) : [];
    return selectBestProductPromotion({ merchantId, variantId: item.variantId, productId: item.productId,
      categoryId: item.categoryId, baseUnitPriceCents: item.unitPriceCents, promotions, now });
  }));
  const ordered = base.items.map((item, index) => ({ index, identity: lineIdentity(item) }))
    .sort((a, b) => a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0);
  if (new Set(ordered.map(line => line.identity)).size !== ordered.length) throw new Error("discount_price_review_required");
  const keys = new Map(ordered.map((line, rank) => [line.index, String(rank).padStart(3, "0")]));
  const allocation = allocatePromotionDiscountBudget({ budgetCents: original.remainingDiscountCents,
    lines: base.items.map((item, index) => ({ key: keys.get(index)!,
      baseUnitPriceCents: item.unitPriceCents, requestedUnitDiscountCents: chosen[index]!.unitDiscountCents, quantity: item.quantity })) });
  const projected = structuredClone(base);
  const allocatedByKey = new Map(allocation.lines.map(line => [line.key, line]));
  projected.items.forEach((item, index) => {
    const key = keys.get(index)!;
    const line = allocatedByKey.get(key)!;
    item.pricingOriginalUnitPriceCents = item.unitPriceCents;
    item.unitPriceCents = line.unitPriceCents;
  });
  projected.total = projected.items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
  projected.discountBudget = { version: 1, originalSubtotalCents: base.total, promotionDiscountCents: allocation.promotionDiscountCents };
  const decision = evaluateCombinedDiscount(toEngineCart(projected, authority.costsByVariant), authority.rules, base.discount);
  if (decision.kind === "requires_review") throw new Error("discount_price_review_required");
  if (decision.kind !== "authorized") {
    if (base.discount > 0) throw new Error("discount_price_review_required");
    cart.commercialNotices = [commercialNotice("benefit_conditions_not_met")];
    return meta;
  }
  projected.items.forEach((item, index) => {
    if (item.unitPriceCents < base.items[index]!.unitPriceCents) setProductPromoBadge(meta, projected.items, item, {
      originalPriceCents: base.items[index]!.unitPriceCents,
      discountPercent: (base.items[index]!.unitPriceCents - item.unitPriceCents) / base.items[index]!.unitPriceCents * 100,
    });
    else if (chosen[index]!.couponIds.length) setProductPromoBadge(meta, projected.items, item, { originalPriceCents: item.unitPriceCents, coupon: true });
  });
  if (decision.totalDiscountCents > 0 && decision.remainingDiscountCents === 0) projected.commercialNotices = [commercialNotice("discount_limit_reached")];
  else if (allocation.limitApplied) projected.commercialNotices = [commercialNotice(authority.rules.maxDiscountPercent === 0 ? "discount_unavailable" : "discount_limited")];
  Object.assign(cart, projected);
  if (!projected.commercialNotices) delete cart.commercialNotices;
  return meta;
}

