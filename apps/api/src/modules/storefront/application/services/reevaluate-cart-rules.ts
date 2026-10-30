import { Logger, UnprocessableEntityException } from "@nestjs/common";
import type { StorefrontCrossSellCartPort } from "../../domain/ports/storefront-cross-sell-cart.port.js";
import { evaluateCombinedDiscount } from "@zyon/rules-engine";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import type { ProductPromotionRepositoryPort } from "../../../catalog/domain/ports/product-promotion-repository.port.js";
import type { StorefrontCartPort } from "../../domain/ports/storefront-cart.port.js";
import { CartRulesEngine, buildCartRuleContext, toEngineCart } from "../../domain/services/cart-rules-engine.service.js";
import { commercialNotice } from "../../domain/services/commercial-notice.js";
import { StorefrontCartSnapshotConflictError } from "../../domain/errors/storefront-cart-snapshot-conflict.error.js";
import { readExistingMerchantRules } from "../../../merchant/application/services/read-existing-merchant-rules.js";
import { RuleProximityEngine, type RuleNudge, type ActiveRuleBadge } from "../../domain/services/rule-proximity.service.js";
import type { AdvancedRule } from "../../../checkout/domain/services/advanced-rule-evaluator.service.js";
import type { StorefrontCart } from "../../domain/ports/storefront-cart.port.js";
import { applyProductPromoPricing, setProductPromoBadge, type ProductPromoMeta } from "./storefront-cart-promo.pricing.js";
import { isDeepStrictEqual } from "node:util";
import { extractOptionGroups, resolveSelectedOptions } from "../../domain/food-options.js";
import { evaluateLegacySavedPriceBasis } from "../../domain/services/storefront-legacy-saved-price.js";
import { LegacySavedPriceReviewRequired, legacySavedPriceReviewNotice } from "./legacy-saved-price-review.js";

export interface CartRulesDependencies {
  prisma: PrismaClient;
  merchantRepo: MerchantRepository;
  cartRepo: StorefrontCartPort;
  productPromotionRepo?: ProductPromotionRepositoryPort;
  crossSellCart?: Pick<StorefrontCrossSellCartPort, "project"> & Partial<Pick<StorefrontCrossSellCartPort,"projectNormalSource">>;
}

const logger = new Logger("CartHandlers");

const cartRulesEngine = new CartRulesEngine();
const ruleProximityEngine = new RuleProximityEngine();

/** Internal cost projection: never persist these values on the buyer-facing cart. */
export async function loadCartCosts(prisma: Pick<Prisma.TransactionClient, "productPrice">, merchantId: string, cart: StorefrontCart, verifyOriginalPrices = false, hydrateSku = false): Promise<Map<string, number>> {
  const prices = await prisma.productPrice.findMany({
    where: { variantId: { in: cart.items.map(item => item.variantId) }, currency: "BRL",
      variant: { isActive: true, product: { merchantId, isActive: true, deletedAt: null } } },
    select: { variantId: true, costInCents: true, basePriceInCents: true,
      variant: { select: { productId: true, ...(hydrateSku ? { sku: true } : {}), product: { select: { categoryId: true, metadata: true } } } } },
  });
  let canonicalSubtotal = 0, savedSubtotal = 0, hasLegacy = false;
  if (verifyOriginalPrices) for (const item of cart.items) {
    const price = prices.find(row => row.variantId === item.variantId);
    if (!price || price.variant?.productId !== item.productId) throw new Error("discount_price_review_required");
    const options = resolveSelectedOptions(extractOptionGroups(price.variant.product.metadata), (item.selectedOptions ?? []).map(option => option.itemId));
    const sort = (values: typeof options.selected) => [...values].sort((a, b) => a.itemId.localeCompare(b.itemId));
    if (!isDeepStrictEqual(sort(options.selected), sort(item.selectedOptions ?? []))) throw new LegacySavedPriceReviewRequired("source_changed");
    const canonical = price.basePriceInCents + options.priceModifierInCents;
    if (!Number.isSafeInteger(canonical) || canonical < 0 || !Number.isSafeInteger(item.unitPriceCents)
      || item.unitPriceCents < 0 || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) throw new Error("discount_price_review_required");
    if (item.unitPriceCents > canonical) throw new LegacySavedPriceReviewRequired("saved_price_above_catalog");
    if (item.crossSellIntent && (item.pricingOriginalUnitPriceCents ?? item.unitPriceCents) !== canonical) throw new Error("discount_price_review_required");
    if (!item.crossSellIntent && item.unitPriceCents < canonical) hasLegacy = true;
    item.pricingOriginalUnitPriceCents = canonical;
    canonicalSubtotal += canonical * item.quantity; savedSubtotal += item.unitPriceCents * item.quantity;
    // Category is authority data, not a remembered UI label.
    item.categoryId = price.variant.product.categoryId ?? undefined;
    if (hydrateSku) {
      if (typeof price.variant.sku !== "string" || !price.variant.sku.trim() || price.variant.sku.length > 191 || price.variant.sku.includes("\0")) throw new Error("discount_price_review_required");
      item.sku = price.variant.sku;
    }
  }
  if (hasLegacy) {
    if (!Number.isSafeInteger(canonicalSubtotal) || !Number.isSafeInteger(savedSubtotal) || cart.total !== savedSubtotal) throw new Error("discount_price_review_required");
    cart.discountBudget = { version: 1, originalSubtotalCents: canonicalSubtotal, promotionDiscountCents: canonicalSubtotal - savedSubtotal };
  }
  return new Map(prices.flatMap(price => price.costInCents == null ? [] : [[price.variantId, price.costInCents / 100] as const]));
}

interface CartRulesOutcome {
  cart: StorefrontCart;
  nextNudge?: RuleNudge | null;
  activeRules?: ActiveRuleBadge[];
  promoMeta?: ProductPromoMeta;
}

export async function loadAdvancedRules(prisma: PrismaClient, merchantId: string): Promise<AdvancedRule[]> {
  try {
    const setting = await prisma.checkoutSetting.findUnique({
      where: { merchantId },
      select: { advancedRules: true },
    });
    return ((setting?.advancedRules as unknown as AdvancedRule[]) ?? []).filter((r) => r?.enabled);
  } catch {
    return [];
  }
}

export async function reevaluateCartRules(
  deps: CartRulesDependencies,
  merchantId: string,
  sessionId: string,
  cart: StorefrontCart,
): Promise<CartRulesOutcome> {
  const expectedCart = structuredClone(cart);
  cart = structuredClone(expectedCart);
  if (cart.merchantId !== merchantId || cart.sessionId !== sessionId) throw new Error("discount_price_review_required");
  // Actual transaction-bound proof, not an intent/metadata flag. Historical
  // NORMAL carts can lose their last promoted target while retaining P0/D.
  const normal=await deps.crossSellCart?.projectNormalSource?.({merchantId,cartId:sessionId},expectedCart);
  if (normal||cart.items.some(item => item.crossSellIntent !== undefined)) {
    if (!deps.crossSellCart) throw new UnprocessableEntityException({ code: "cross_sell_quote_review_required", message: "Este benefício precisa de uma nova cotação." });
    const projected = normal??await deps.crossSellCart.project({ merchantId, cartId: sessionId }, expectedCart);
    const promoMeta: ProductPromoMeta = new Map();
    for (const item of projected.items) if (item.pricingOriginalUnitPriceCents !== undefined)
      setProductPromoBadge(promoMeta, projected.items, item, { originalPriceCents: item.pricingOriginalUnitPriceCents });
    return { cart: projected, promoMeta, nextNudge: null, activeRules: [] };
  }
  // An empty cart without a benefit has nothing to reprice or revoke. Do not
  // turn zero-subtotal rule evaluation into a fictitious rejected benefit.
  if (!cart.items.length && !cart.couponCode && !cart.discount && !cart.freeShipping) {
    return { cart: { ...cart, commercialNotices: [] }, promoMeta: new Map(), nextNudge: null, activeRules: [] };
  }
  try {
    const advancedRules = await loadAdvancedRules(deps.prisma, merchantId);
    const projected = structuredClone(cart);
    const costs = await loadCartCosts(deps.prisma, merchantId, projected, true);
    const legacy = projected.items.some(item => item.pricingOriginalUnitPriceCents !== undefined && item.pricingOriginalUnitPriceCents > item.unitPriceCents);
    if (legacy) {
      const rules = await readExistingMerchantRules(deps.merchantRepo, merchantId);
      if (!rules) throw new LegacySavedPriceReviewRequired("source_changed");
      const decision = evaluateLegacySavedPriceBasis({ lines: projected.items.map(item => ({ canonicalUnitPriceCents: item.pricingOriginalUnitPriceCents!,
        savedUnitPriceCents: item.unitPriceCents, quantity: item.quantity })), cartDiscountCents: projected.discount, maxDiscountPercent: rules.maxDiscountPercent });
      if (decision.kind !== "preserved") throw new LegacySavedPriceReviewRequired(decision.reason);
      const promoMeta = await applyProductPromoPricing(deps.productPromotionRepo, merchantId, projected, { rules, costsByVariant: costs });
      // Explicit legacy preservation is a read projection, not a new receipt,
      // automatic D, price write, TTL refresh or promotion reapplication.
      return { cart: projected, promoMeta, nextNudge: null, activeRules: [] };
    }
    if (!advancedRules.length && !deps.productPromotionRepo && !cart.couponCode) {
      if (!cart.couponCode && (cart.discount || cart.freeShipping)) {
        const clean = await deps.cartRepo.applyRuleOutcome(merchantId, sessionId, { discountCents: 0, freeShipping: false }, expectedCart);
        return { cart: clean, promoMeta: new Map(), nextNudge: null, activeRules: [] };
      }
      return { cart, promoMeta: new Map(), nextNudge: null, activeRules: [] };
    }
    const merchantRules = await readExistingMerchantRules(deps.merchantRepo, merchantId);
    if (!merchantRules) throw new Error("merchant_rules_unavailable");
    if (!projected.couponCode) projected.discount = 0; // Recompute target, never add old automatic targets.
    const promoMeta = await applyProductPromoPricing(deps.productPromotionRepo, merchantId, projected, { rules: merchantRules, costsByVariant: costs });
    const categoriesInCart = projected.items
      .map((i) => i.categoryId ?? "")
      .filter(Boolean);
    const ctx = buildCartRuleContext(projected, { categoriesInCart });
    const outcome = cartRulesEngine.evaluate(projected, advancedRules, merchantRules, ctx, costs);
    const target = projected.couponCode ? projected.discount : outcome.discountCents;
    const engineCart = toEngineCart(projected, costs);
    engineCart.currentDiscount = projected.couponCode ? projected.discount / 100 : 0;
    const combined = evaluateCombinedDiscount(engineCart, merchantRules, target);
    if (combined.kind === "requires_review") throw new Error("discount_price_review_required");
    if (combined.kind !== "authorized" && projected.couponCode) throw new Error("discount_price_review_required");
    const discountCents = combined.kind === "authorized" ? combined.cartDiscountCents : 0;
    // Merchandise authorization neither grants nor revokes an existing shipping
    // coupon. Its quote/subsidy authority remains separate.
    const freeShipping = projected.couponCode ? projected.freeShipping : outcome.freeShipping;
    if (combined.kind === "authorized" && combined.totalDiscountCents > 0 && combined.remainingDiscountCents === 0) {
      projected.commercialNotices = [commercialNotice("discount_limit_reached")];
    } else if (outcome.reason === "discount_disabled_by_merchant") projected.commercialNotices = [commercialNotice("discount_unavailable")];
    else if (outcome.reason === "capped_by_combined_discount_limit") projected.commercialNotices = [commercialNotice("discount_limited")];
    logger.debug("cart.rules.applied", {
      merchantId, sessionId,
      discountCents: outcome.discountCents,
      freeShipping: outcome.freeShipping,
      reason: outcome.reason,
      ruleId: outcome.appliedRuleId,
    });
    const persisted = await deps.cartRepo.applyRuleOutcome(merchantId, sessionId, {
      discountCents,
      freeShipping,
    }, expectedCart);

    // Do not promote again after the extra target was authorized: that would
    // reserve it twice or replace the selected product savings.
    projected.discount = persisted.discount;
    projected.freeShipping = persisted.freeShipping;
    projected.updatedAt = persisted.updatedAt;

    const hadEffect = (!cart.couponCode && discountCents > 0) || outcome.freeShipping === true;
    const effectiveRuleId = hadEffect ? outcome.appliedRuleId : undefined;
    const noticeRules = advancedRules.filter((rule) => rule.action.type !== "offer_free_shipping" || merchantRules.allowFreeShipping !== false)
      .filter(rule => rule.action.type !== "offer_discount" || combined.kind !== "authorized" || combined.remainingDiscountCents > 0)
      .map((rule) => rule.action.type === "offer_discount" ? {
        ...rule, action: { ...rule.action, params: { ...rule.action.params, percent: Math.min(Number(rule.action.params.percent), merchantRules.maxDiscountPercent) } },
      } : rule);
    const proximity = ruleProximityEngine.compute(noticeRules, buildCartRuleContext(projected, { categoriesInCart }), effectiveRuleId, { discountCents: cart.couponCode ? 0 : discountCents, freeShipping: outcome.freeShipping });
    return { cart: projected, nextNudge: proximity.nextNudge, activeRules: proximity.active, promoMeta };
  } catch (err) {
    if (err instanceof LegacySavedPriceReviewRequired) return { cart: { ...expectedCart, commercialNotices: [legacySavedPriceReviewNotice()] },
      promoMeta: new Map(), nextNudge: null, activeRules: [] };
    logger.warn("cart.reevaluateRules.failed", {
      merchantId,
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    // A failed cost/policy read must never keep an automatic incentive from
    // a previous cart state. Coupon revalidation needs its own authority.
    if (cart.couponCode || err instanceof StorefrontCartSnapshotConflictError
      || (err instanceof Error && err.message === "discount_price_review_required")) throw err;
    const clean = await deps.cartRepo.applyRuleOutcome(merchantId, sessionId, { discountCents: 0, freeShipping: false }, expectedCart);
    clean.commercialNotices = [commercialNotice("benefit_conditions_not_met")];
    return { cart: clean, promoMeta: new Map(), nextNudge: null, activeRules: [] };
  }
}



