import { BadRequestException, Inject, Injectable, Optional } from "@nestjs/common";
import { z } from "zod";
import type { Cart, CheckoutSession, MerchantRules } from "@zyon/shared-types";
import { evaluateCombinedDiscount, moneyCents } from "@zyon/rules-engine";
import { PRODUCT_PROMOTION_REPOSITORY, type ProductPromotionRepositoryPort } from "../../../catalog/domain/ports/product-promotion-repository.port.js";
import { allocatePromotionDiscountBudget, selectBestProductPromotion } from "../../../catalog/domain/services/best-product-promotion.service.js";
import { MERCHANT_RULES_REPOSITORY, type MerchantRulesRepository } from "../../../merchant/domain/ports/merchant-rules.repository.port.js";
import { readExistingMerchantRules } from "../../../merchant/application/services/read-existing-merchant-rules.js";
import { commercialNotice } from "../../../storefront/domain/services/commercial-notice.js";
import { isDeepStrictEqual } from "node:util";
import { STOREFRONT_CROSS_SELL_CART, type StorefrontCrossSellCartPort } from "../../../storefront/domain/ports/storefront-cross-sell-cart.port.js";
import type { StorefrontCartItem } from "../../../storefront/domain/ports/storefront-cart.port.js";
import { LegacySavedPriceReviewRequired } from "../../../storefront/application/services/legacy-saved-price-review.js";
import { NORMAL_CHECKOUT_CROSS_SELL, type NormalCheckoutCrossSellPort } from "../../../cross-sell/domain/ports/normal-checkout-cross-sell.port.js";

const cents = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const budget = z.strictObject({ version: z.literal(1), originalSubtotalCents: cents, promotionDiscountCents: cents });
const policy = z.object({ maxDiscountPercent: z.number().finite().min(0).max(100), minimumMarginPercent: z.number().finite().min(0).max(100),
  merchantId: z.string().optional() });
const requiredCents = (value: unknown) => { const parsed = moneyCents(value); if (parsed === null) throw new BadRequestException("checkout_price_review_required"); return parsed; };
const optionIdentity = z.tuple([z.string().min(1).max(191), z.array(z.string().min(1).max(191))]);
export const checkoutCartLineIdentity = (item: Pick<Cart["items"][number], "variantId" | "variant" | "fulfillmentSchedule">): string => {
  let optionIds: string[] = [];
  if (item.variant !== undefined) {
    try {
      const parsed = optionIdentity.parse(JSON.parse(item.variant));
      if (parsed[0] !== item.variantId || new Set(parsed[1]).size !== parsed[1].length) throw new Error();
      optionIds = parsed[1].sort();
    } catch { throw new BadRequestException("checkout_price_review_required"); }
  }
  return JSON.stringify([item.variantId, JSON.stringify([item.variantId, optionIds]), item.fulfillmentSchedule?.slotId ?? null]);
};
const lineIdentity = checkoutCartLineIdentity;
export const storefrontCrossSellLineIdentity = (line: StorefrontCartItem) => JSON.stringify([line.variantId,
  JSON.stringify([line.variantId, (line.selectedOptions ?? []).map(option => option.itemId).sort()]), line.selectedServiceSlot?.slotId ?? null]);
export const storefrontCrossSellOptionsMatch = (item: Cart["items"][number], line: StorefrontCartItem) =>
  !(item.selected_options?.length && item.variant === undefined) && isDeepStrictEqual(item.selected_options ?? [],
    (line.selectedOptions ?? []).map(option => ({ group_name: option.groupName, item_name: option.itemName, price_modifier: option.priceModifierInCents / 100 })));

/** Trusted server-quotation projection only. Public carts MUST first pass the
 * checkout authority, which drops client originalPrice/budget/discount data.
 * No persisted base is changed, no promotion is applied twice, and no policy or
 * read failure is replaced with a permissive default. */
@Injectable()
export class CartPromoResolutionService {
  constructor(
    @Optional() @Inject(PRODUCT_PROMOTION_REPOSITORY) private readonly promoRepo?: ProductPromotionRepositoryPort,
    @Optional() @Inject(MERCHANT_RULES_REPOSITORY) private readonly merchantRules?: Pick<MerchantRulesRepository, "getRules" | "getExistingRules">,
    @Optional() @Inject(STOREFRONT_CROSS_SELL_CART) private readonly crossSellCart?: Pick<StorefrontCrossSellCartPort, "projectForCheckout">,
    @Optional() @Inject(NORMAL_CHECKOUT_CROSS_SELL) private readonly normalCrossSell?: Pick<NormalCheckoutCrossSellPort,"read">,
  ) {}

  /** Only a session-bound, transaction-backed reader may revalidate normal
   * authored intents. The cart-only/body entrypoint below remains failclosed.
   * This projection is not authority for a subsequent detached write/send. */
  async resolveSessionCartPromos(session:CheckoutSession):Promise<CheckoutSession>{
    if(session.cart.items.some(item=>item.crossSellIntent!==undefined)&&(this.normalCrossSell||session.cart.source!=="storefront")){
      if(!this.normalCrossSell||session.cart.commerceCartRef)throw new BadRequestException("checkout_price_review_required");
      return this.normalCrossSell.read({merchantId:session.merchantId,sessionId:session.sessionId},session);
    }
    return {...session,cart:await this.resolveCartPromos(session.cart,session.merchantId)};
  }

  async resolveCartPromos(value: Cart, merchantId: string, now = new Date()): Promise<Cart> {
    const cart = structuredClone(value);
    const pricingTime = new Date(now.getTime());
    if (!cart || !Array.isArray(cart.items) || !cart.items.length) return cart;
    if (cart.items.some(item => item.crossSellIntent !== undefined)) {
      if (!this.crossSellCart || cart.source !== "storefront" || !cart.cart_ref || cart.currency !== "BRL") throw new BadRequestException("checkout_price_review_required");
      const { cart: current, costsByVariant } = await this.crossSellCart.projectForCheckout({ merchantId, cartId: cart.cart_ref });
      if (current.items.length !== cart.items.length || new Set(current.items.map(storefrontCrossSellLineIdentity)).size !== current.items.length
        || new Set(cart.items.map(lineIdentity)).size !== cart.items.length) throw new BadRequestException("checkout_price_review_required");
      const items = cart.items.map(item => {
        const line = current.items.find(line => storefrontCrossSellLineIdentity(line) === lineIdentity(item));
        if (!line || line.productId !== item.product_id || line.sku !== item.sku || line.quantity !== item.quantity
          || !storefrontCrossSellOptionsMatch(item, line)
          || !isDeepStrictEqual(line.crossSellIntent, item.crossSellIntent)
          || requiredCents(item.originalPrice ?? item.price) !== (line.pricingOriginalUnitPriceCents ?? line.unitPriceCents)) throw new BadRequestException("checkout_price_review_required");
        const { originalPrice: _priorOriginal, cost: _priorCost, ...base } = item;
        return { ...base, price: line.unitPriceCents / 100,
          ...(costsByVariant.has(line.variantId) ? { cost: costsByVariant.get(line.variantId) } : {}),
          ...(line.pricingOriginalUnitPriceCents === undefined ? {} : { originalPrice: line.pricingOriginalUnitPriceCents / 100 }) };
      });
      if (new Set(items.map(lineIdentity)).size !== items.length) throw new BadRequestException("checkout_price_review_required");
      const { commercialNotices: _priorNotices, ...base } = cart;
      return { ...base, items, total: current.total / 100, currentDiscount: current.discount / 100,
        discountBudget: current.discountBudget, ...(current.commercialNotices ? { commercialNotices: current.commercialNotices } : {}) };
    }
    const subtotal = cart.items.reduce((sum, item) => {
      if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) throw new BadRequestException("checkout_quantity_invalid");
      return sum + BigInt(requiredCents(item.price)) * BigInt(item.quantity);
    }, 0n);
    if (subtotal > BigInt(Number.MAX_SAFE_INTEGER) || Number(subtotal) !== requiredCents(cart.total)) throw new BadRequestException("checkout_price_review_required");
    const existing = requiredCents(cart.currentDiscount ?? 0);
    if (cart.currency !== "BRL") {
      if (existing > 0 || cart.discountBudget !== undefined || cart.items.some(item => item.originalPrice !== undefined)) {
        throw new BadRequestException("checkout_price_review_required");
      }
      // Currency conversion and BRL incentives are not authorized here. Preserve
      // the legacy no-benefit quote without manufacturing metadata or a grant.
      return cart;
    }
    const readRules = async (): Promise<MerchantRules> => {
      if (!this.merchantRules) throw new BadRequestException("checkout_discount_policy_unavailable");
      const raw = await readExistingMerchantRules(this.merchantRules, merchantId);
      if (!raw) throw new BadRequestException("checkout_discount_policy_unavailable");
      const checked = policy.parse(raw);
      if (checked.merchantId !== undefined && checked.merchantId !== merchantId) throw new BadRequestException("checkout_discount_policy_unavailable");
      return raw;
    };
    if (cart.discountBudget !== undefined) {
      budget.parse(cart.discountBudget);
      const originals = cart.items.reduce((sum, item) => sum + BigInt(requiredCents(item.originalPrice ?? item.price)) * BigInt(item.quantity), 0n);
      if (originals !== BigInt(cart.discountBudget.originalSubtotalCents)
        || cart.items.some(item => (item.originalPrice ?? item.price) < item.price)) throw new BadRequestException("checkout_price_review_required");
      const rules = await readRules();
      const decision = evaluateCombinedDiscount(cart, rules, existing);
      if (decision.kind !== "authorized") {
        if (cart.source === "storefront") throw new LegacySavedPriceReviewRequired("above_company_limit");
        throw new BadRequestException("checkout_price_review_required");
      }
      const selected = await Promise.all(cart.items.map(async item => {
        const canonical = requiredCents(item.originalPrice ?? item.price) === requiredCents(item.price);
        if (!canonical || !this.promoRepo) return { unitDiscountCents: 0 };
        if (!item.variantId || !item.product_id) throw new BadRequestException("checkout_promotion_identity_unavailable");
        const rows = await this.promoRepo.findActiveBySku(merchantId, item.variantId, new Date(pricingTime.getTime()));
        return selectBestProductPromotion({ merchantId, variantId: item.variantId, productId: item.product_id,
          categoryId: item.category, baseUnitPriceCents: requiredCents(item.price), promotions: rows, now: pricingTime });
      }));
      const ordered = cart.items.map((item, index) => ({ index, identity: lineIdentity(item) }))
        .sort((a, b) => a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0);
      if (new Set(ordered.map(line => line.identity)).size !== ordered.length) throw new BadRequestException("checkout_price_review_required");
      const keys = new Map(ordered.map((line, rank) => [line.index, String(rank).padStart(3, "0")]));
      const allocation = allocatePromotionDiscountBudget({ budgetCents: decision.remainingDiscountCents,
        lines: cart.items.map((item, index) => ({ key: keys.get(index)!, baseUnitPriceCents: requiredCents(item.price),
          requestedUnitDiscountCents: selected[index]!.unitDiscountCents, quantity: item.quantity })) });
      const allocated = new Map(allocation.lines.map(line => [line.key, line]));
      const projected: Cart = { ...cart, items: cart.items.map((item, index) => {
        const line = allocated.get(keys.get(index)!)!;
        return { ...item, price: line.unitPriceCents / 100,
          ...(line.unitDiscountCents > 0 ? { originalPrice: item.originalPrice ?? item.price } : {}) };
      }), total: (Number(subtotal) - allocation.promotionDiscountCents) / 100,
        discountBudget: { ...cart.discountBudget, promotionDiscountCents: cart.discountBudget.promotionDiscountCents + allocation.promotionDiscountCents } };
      const confirmed = evaluateCombinedDiscount(projected, rules, existing);
      if (confirmed.kind !== "authorized") throw new BadRequestException("checkout_price_review_required");
      const wasLimited = cart.commercialNotices?.some(notice => notice.code === "discount_limited");
      const wasUnavailable = cart.commercialNotices?.some(notice => notice.code === "discount_unavailable");
      delete projected.commercialNotices;
      if (confirmed.totalDiscountCents > 0 && confirmed.remainingDiscountCents === 0) projected.commercialNotices = [commercialNotice("discount_limit_reached")];
      else if ((wasUnavailable || selected.some(line => line.unitDiscountCents > 0)) && rules.maxDiscountPercent === 0) projected.commercialNotices = [commercialNotice("discount_unavailable")];
      else if (wasLimited || allocation.limitApplied) projected.commercialNotices = [commercialNotice("discount_limited")];
      return projected;
    }
    if (cart.items.some(item => item.originalPrice !== undefined)) throw new BadRequestException("checkout_price_review_required");
    if (!this.promoRepo) {
      if (existing > 0) throw new BadRequestException("checkout_discount_policy_unavailable");
      return cart;
    }
    const selected = await Promise.all(cart.items.map(async item => {
      if (!item.variantId || !item.product_id) throw new BadRequestException("checkout_promotion_identity_unavailable");
      const rows = await this.promoRepo!.findActiveBySku(merchantId, item.variantId, new Date(pricingTime.getTime()));
      return selectBestProductPromotion({ merchantId, variantId: item.variantId, productId: item.product_id, categoryId: item.category,
        baseUnitPriceCents: requiredCents(item.price), promotions: rows, now: pricingTime });
    }));
    const hasRequestedPromotion = selected.some(result => result.unitDiscountCents > 0);
    if (!hasRequestedPromotion && existing === 0 && !this.merchantRules) return cart;
    const rules = await readRules();
    const basis = evaluateCombinedDiscount(cart, rules, existing);
    if (basis.kind !== "authorized") throw new BadRequestException("checkout_price_review_required");
    const lines = cart.items.map((item, index) => ({ key: String(index).padStart(3, "0"),
      baseUnitPriceCents: requiredCents(item.price), requestedUnitDiscountCents: selected[index]!.unitDiscountCents, quantity: item.quantity }));
    const stableOrder = cart.items.map((item, index) => ({ index, identity: lineIdentity(item) }))
      .sort((a, b) => a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0);
    if (new Set(stableOrder.map(item => item.identity)).size !== stableOrder.length) throw new BadRequestException("checkout_price_review_required");
    for (const [rank, line] of stableOrder.entries()) lines[line.index]!.key = String(rank).padStart(3, "0");
    const allocation = allocatePromotionDiscountBudget({ lines, budgetCents: basis.remainingDiscountCents });
    const byKey = new Map(allocation.lines.map(line => [line.key, line]));
    const projected: Cart = { ...cart, items: cart.items.map((item, index) => {
      const line = byKey.get(lines[index]!.key)!;
      return { ...item, price: line.unitPriceCents / 100, ...(line.unitDiscountCents > 0 ? { originalPrice: item.price } : {}) };
    }), total: (Number(subtotal) - allocation.promotionDiscountCents) / 100,
      discountBudget: { version: 1, originalSubtotalCents: Number(subtotal), promotionDiscountCents: allocation.promotionDiscountCents } };
    const decision = evaluateCombinedDiscount(projected, rules, existing);
    if (decision.kind === "requires_review") throw new BadRequestException("checkout_price_review_required");
    if (decision.kind !== "authorized") {
      return { ...cart, discountBudget: { version: 1, originalSubtotalCents: Number(subtotal), promotionDiscountCents: 0 },
        commercialNotices: [commercialNotice("benefit_conditions_not_met")] };
    }
    delete projected.commercialNotices;
    const code = hasRequestedPromotion && rules.maxDiscountPercent === 0 ? "discount_unavailable"
      : decision.totalDiscountCents > 0 && decision.remainingDiscountCents === 0 ? "discount_limit_reached"
        : allocation.limitApplied ? "discount_limited" : undefined;
    if (code) projected.commercialNotices = [commercialNotice(code)];
    return projected;
  }
}
