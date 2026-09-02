import type { StoreToolHandlers } from "../../domain/tools/types.js";
import type { ToolRequestContext } from "../../domain/tools/tool-context.js";
import type { ProductRepositoryPort, StockRepositoryPort } from "../../../catalog/domain/ports/product-repository.port.js";
import type { StorefrontCartPort, StorefrontCartSelectedOption } from "../../domain/ports/storefront-cart.port.js";
import { extractOptionGroups, resolveSelectedOptions, FoodOptionValidationError } from "../../domain/food-options.js";
import type { ListEligibleCrossSellsUseCase } from "../../../cross-sell/application/use-cases/list-eligible-cross-sells.use-case.js";
import type { CrossSellPromotionRepository } from "../../../cross-sell/domain/ports/cross-sell-promotion-repository.port.js";
import type { ApplyCouponUseCase } from "../../../coupons/application/use-cases/apply-coupon.use-case.js";
import type { CouponRepository } from "../../../coupons/domain/ports/coupon-repository.port.js";
import type { Cart } from "@zyon/shared-types";
import type { SearchFederatedProductsUseCase } from "../../../marketplace/application/use-cases/search-federated-products.use-case.js";
import type { AddMarketplaceItemToCartStorefrontUseCase } from "../../application/use-cases/add-marketplace-item-to-cart.use-case.js";
import type { PrismaClient } from "@prisma/client";
import type { MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import { Logger } from "@nestjs/common";
import { buildCrossSellSuggestions, type CrossSellConfig, type CrossSellSuggestion } from "./cart-cross-sell.helper.js";
import { CartRulesEngine, buildCartRuleContext } from "../../domain/services/cart-rules-engine.service.js";
import { RuleProximityEngine, type RuleNudge, type ActiveRuleBadge } from "../../domain/services/rule-proximity.service.js";
import type { AdvancedRule } from "../../../checkout/domain/services/advanced-rule-evaluator.service.js";
import type { StorefrontCart } from "../../domain/ports/storefront-cart.port.js";

const logger = new Logger("CartHandlers");

const cartRulesEngine = new CartRulesEngine();
const ruleProximityEngine = new RuleProximityEngine();

interface CartRulesOutcome {
  cart: StorefrontCart;
  nextNudge?: RuleNudge | null;
  activeRules?: ActiveRuleBadge[];
}

async function loadAdvancedRules(prisma: PrismaClient, merchantId: string): Promise<AdvancedRule[]> {
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

async function reevaluateCartRules(
  deps: CartHandlerDeps,
  merchantId: string,
  sessionId: string,
  cart: StorefrontCart,
): Promise<CartRulesOutcome> {
  try {
    const advancedRules = await loadAdvancedRules(deps.prisma, merchantId);
    if (advancedRules.length === 0) return { cart };
    const merchantRules = await deps.merchantRepo.getRules(merchantId);
    if (!merchantRules) return { cart };
    const categoriesInCart = cart.items
      .map((i) => (i as { category?: string }).category ?? "")
      .filter(Boolean);
    const ctx = buildCartRuleContext(cart, { categoriesInCart });
    const outcome = cartRulesEngine.evaluate(cart, advancedRules, merchantRules, ctx);
    logger.debug("cart.rules.applied", {
      merchantId, sessionId,
      discountCents: outcome.discountCents,
      freeShipping: outcome.freeShipping,
      reason: outcome.reason,
      ruleId: outcome.appliedRuleId,
    });
    const persisted = await deps.cartRepo.applyRuleOutcome(merchantId, sessionId, {
      discountCents: outcome.discountCents,
      freeShipping: outcome.freeShipping,
    });

    const hadEffect = outcome.discountCents > 0 || outcome.freeShipping === true;
    const effectiveRuleId = hadEffect ? outcome.appliedRuleId : undefined;
    const proximity = ruleProximityEngine.compute(advancedRules, buildCartRuleContext(persisted, { categoriesInCart }), effectiveRuleId);
    return { cart: persisted, nextNudge: proximity.nextNudge, activeRules: proximity.active };
  } catch (err) {
    logger.warn("cart.reevaluateRules.failed", {
      merchantId,
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { cart };
  }
}

function toCartLineDto(i: {
  variantId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  imageUrl?: string;
  selectedOptions?: StorefrontCartSelectedOption[];
}) {
  return {
    variantId: i.variantId,
    name: i.name,
    quantity: i.quantity,
    unitPrice: i.unitPriceCents / 100,
    lineTotal: (i.unitPriceCents * i.quantity) / 100,
    imageUrl: i.imageUrl,
    selectedOptions: i.selectedOptions?.map((o) => ({
      groupName: o.groupName,
      itemName: o.itemName,
      priceModifier: o.priceModifierInCents / 100,
    })),
  };
}

export interface CartHandlerDeps {
  productRepo: ProductRepositoryPort;
  stockRepo: StockRepositoryPort;
  cartRepo: StorefrontCartPort;
  prisma: PrismaClient;
  merchantRepo: MerchantRepository;
  searchFederatedProducts?: SearchFederatedProductsUseCase;
  /**
   * Cross-store add: when a federated (other-store) product is added, this
   * use-case creates the cross_store_line_items row with frozen commission so
   * PlaceCrossStoreOrder can build settlements at checkout. Optional: when
   * absent, the item still lands in the local cart but no settlement is created.
   */
  addMarketplaceItemToCart?: AddMarketplaceItemToCartStorefrontUseCase;
  listEligibleCrossSells?: ListEligibleCrossSellsUseCase;
  loadCrossSellConfig: (merchantId: string) => Promise<CrossSellConfig>;
  crossSellPromotionRepo?: CrossSellPromotionRepository;
  applyCouponUseCase?: ApplyCouponUseCase;
  /**
   * Coupon repo — lists the merchant's real active coupons for list_promotions.
   * Replaces a hardcoded fake "ZYON10" promotion. Optional: when absent,
   * list_promotions returns an empty list (never an invented coupon).
   */
  couponRepo?: CouponRepository;
}

export function createCartHandlers(deps: CartHandlerDeps, ctx: ToolRequestContext): Pick<StoreToolHandlers, "addItemToCart" | "getCart" | "removeCartItem" | "updateCartItem" | "clearCart" | "quoteShipping" | "applyCoupon" | "removeCoupon" | "listPromotions" | "createCheckoutSession"> {
  return {
    addItemToCart: async (args) => {
      const sessionId = ctx.sessionId || `cart_${Date.now()}`;

      logger.debug("cart.addItem", { merchantId: ctx.merchantId, sessionId, variantId: args.variantId, qty: args.quantity });

      let productName = "Produto";
      let unitPriceCents = 0;
      let imageUrl: string | undefined;
      let resolvedVariantId = args.variantId;
      let resolvedProduct: Awaited<ReturnType<typeof deps.productRepo.findById>> | null = null;
      // Cross-store: set when the resolved product is federated (another store's).
      let crossStoreSellerId: string | undefined;
      let crossStoreFederatedProductId: string | undefined;

      try {
        let product = await deps.productRepo.findById(ctx.merchantId, "dummy").catch(() => null);
        let foundVariant = null;

        const searchResult = await deps.productRepo.search({ merchantId: ctx.merchantId, limit: 100 });
        product = searchResult.products.find(p =>
          p.variants.some(v => v.id === args.variantId || v.sku === args.variantId)
        ) ?? null;

        if (product) {
          foundVariant = product.variants.find(v => v.id === args.variantId || v.sku === args.variantId);
          if (foundVariant) {
            resolvedProduct = product;
            productName = product.name;
            resolvedVariantId = foundVariant.id;
            unitPriceCents = foundVariant.basePriceInCents;
            imageUrl = foundVariant.media?.[0]?.url;
          }
        }

        if (!foundVariant) {
          product = await deps.productRepo.findById(ctx.merchantId, args.variantId);
          if (product) {
            resolvedProduct = product;
            productName = product.name;
            const variant = product.variants[0];
            if (variant) {
              resolvedVariantId = variant.id;
              unitPriceCents = variant.basePriceInCents;
              imageUrl = variant.media?.[0]?.url;
            }
          }
        }

        // Last-resort resolution by PRODUCT ID or NAME against the catalog. The
        // LLM sometimes passes the product id (not a variant id) or even the
        // product NAME as `variantId` (e.g. "RTP-PRODUCT-001") — a known
        // model-reliability gap. Rather than reject a real, in-catalog product,
        // match it deterministically and use its default (first) variant. Price
        // is still taken server-side from the resolved variant (never the client).
        if (!foundVariant && unitPriceCents === 0) {
          const needle = (args.variantId ?? "").trim().toLowerCase();
          const byIdOrName = searchResult.products.find(p =>
            p.id === args.variantId || p.name.trim().toLowerCase() === needle,
          );
          const variant = byIdOrName?.variants[0];
          if (byIdOrName && variant) {
            resolvedProduct = byIdOrName;
            productName = byIdOrName.name;
            resolvedVariantId = variant.id;
            unitPriceCents = variant.basePriceInCents;
            imageUrl = variant.media?.[0]?.url;
          }
        }

        if (unitPriceCents === 0 && deps.searchFederatedProducts) {
          try {
            const fedProduct = await deps.prisma.federatedProduct.findUnique({
              where: { id: args.variantId },
            });
            if (fedProduct) {
              productName = fedProduct.name;
              unitPriceCents = fedProduct.priceCents;
              imageUrl = fedProduct.imageUrl ?? undefined;
              resolvedVariantId = fedProduct.id;
              crossStoreSellerId = fedProduct.sourceMerchantId;
              crossStoreFederatedProductId = fedProduct.id;
            }
          } catch { }
        }
      } catch {
      }

      try {
        const stock = await deps.stockRepo.getAvailableStock(resolvedVariantId);
        if (stock.quantity <= 0) {
          logger.warn("cart.stock.zero_qty", { variantId: resolvedVariantId });
        }
      } catch {
      }

      // Food option groups: validate the buyer's selection against the product's
      // stored groups and re-compute the price modifier server-side. The client
      // never dictates price (deterministic offer-math). A missing required
      // group, an unknown item id, or multiple picks in a single-select group is
      // rejected rather than silently priced wrong.
      let selectedOptions: StorefrontCartSelectedOption[] | undefined;
      const optionGroups = extractOptionGroups(resolvedProduct?.metadata);
      const requestedItemIds = Array.isArray(args.selectedOptionItemIds) ? args.selectedOptionItemIds : [];
      if (optionGroups.length > 0 || requestedItemIds.length > 0) {
        try {
          const { selected, priceModifierInCents } = resolveSelectedOptions(optionGroups, requestedItemIds);
          if (selected.length > 0) selectedOptions = selected;
          unitPriceCents += priceModifierInCents;
        } catch (e) {
          if (e instanceof FoodOptionValidationError) {
            return { error: e.code, detail: e.message };
          }
          throw e;
        }
      }

      if (!Number.isFinite(unitPriceCents) || unitPriceCents <= 0) {
        logger.warn("cart.addItem.unresolved_variant", {
          merchantId: ctx.merchantId,
          sessionId,
          requestedVariantId: args.variantId,
          resolvedVariantId,
        });
        return {
          error: "variant_not_resolved",
          detail: `Não encontrei o produto "${args.variantId}" no catálogo para adicionar ao carrinho.`,
        };
      }

      let appliedCrossSellDiscountCents = 0;
      if (args.crossSellPromoId) {
        try {
          const crossSellRepo = deps.crossSellPromotionRepo;
          if (!crossSellRepo) {
            logger.warn("cart.addItem.crossSellRepo_missing", { merchantId: ctx.merchantId, promoId: args.crossSellPromoId });
          } else {
            const promo = await crossSellRepo.findById(args.crossSellPromoId, ctx.merchantId);
            if (!promo) {
              logger.warn("cart.addItem.crossSellPromo_notfound", { merchantId: ctx.merchantId, promoId: args.crossSellPromoId });
            } else if (!promo.isActive()) {
              logger.log("cart.addItem.crossSellPromo_inactive", { merchantId: ctx.merchantId, promoId: args.crossSellPromoId });
            } else {
              const snapRecommendedSkus = new Set(promo.snapshot().recommended_skus.map((s: string) => s.toLowerCase()));
              if (!snapRecommendedSkus.has(resolvedVariantId.toLowerCase()) && !snapRecommendedSkus.has((args.variantId ?? "").toLowerCase())) {
                logger.warn("cart.addItem.crossSellPromo_sku_mismatch", {
                  merchantId: ctx.merchantId,
                  promoId: args.crossSellPromoId,
                  requestedSku: args.variantId,
                  resolvedSku: resolvedVariantId,
                });
              } else {
                const merchantRules = await deps.merchantRepo.getRules(ctx.merchantId);
                const promoDiscount = promo.snapshot().discount_percent;
                const promoMaxDiscount = promo.snapshot().max_discount_percent;
                const merchantMaxDiscount = merchantRules?.maxDiscountPercent ?? 100;
                const cappedDiscount = Math.min(promoDiscount, promoMaxDiscount, merchantMaxDiscount);
                appliedCrossSellDiscountCents = Math.round((unitPriceCents * cappedDiscount) / 100);
                unitPriceCents = unitPriceCents - appliedCrossSellDiscountCents;
                logger.debug("cart.addItem.crossSellPromo_applied", {
                  merchantId: ctx.merchantId,
                  promoId: args.crossSellPromoId,
                  discountPercent: cappedDiscount,
                  discountCents: appliedCrossSellDiscountCents,
                  finalUnitPriceCents: unitPriceCents,
                });
              }
            }
          }
        } catch (err) {
          logger.error("cart.addItem.crossSellPromo_error", {
            merchantId: ctx.merchantId,
            promoId: args.crossSellPromoId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const addedCart = await deps.cartRepo.addItem(ctx.merchantId, sessionId, {
        variantId: resolvedVariantId,
        productId: args.variantId,
        name: productName,
        sku: resolvedVariantId,
        unitPriceCents,
        imageUrl,
        quantity: args.quantity,
        selectedOptions,
      });

      // Cross-store: mirror the federated item into cross_store_line_items with
      // frozen commission so PlaceCrossStoreOrder can build the seller settlement
      // at checkout. The local cart item above is what the buyer sees/pays; this
      // parallel row is the marketplace ledger input. Failure here must not block
      // the add (graceful degradation) — logged for follow-up.
      if (crossStoreSellerId && crossStoreFederatedProductId && deps.addMarketplaceItemToCart) {
        try {
          const res = await deps.addMarketplaceItemToCart.execute({
            merchantId: ctx.merchantId,
            checkoutSessionId: sessionId,
            sellerMerchantId: crossStoreSellerId,
            federatedProductId: crossStoreFederatedProductId,
            quantity: args.quantity,
            unitPriceCents,
          });
          if (!res.success) {
            logger.warn("cart.addItem.crossStore_failed", { merchantId: ctx.merchantId, sessionId, sellerMerchantId: crossStoreSellerId, message: res.message });
          } else {
            logger.log("cart.addItem.crossStore_ok", { merchantId: ctx.merchantId, sessionId, sellerMerchantId: crossStoreSellerId, lineItemId: res.lineItemId });
          }
        } catch (err) {
          logger.error("cart.addItem.crossStore_error", { merchantId: ctx.merchantId, sessionId, error: err instanceof Error ? err.message : String(err) });
        }
      }
      const { cart, nextNudge, activeRules } = await reevaluateCartRules(deps, ctx.merchantId, sessionId, addedCart);
      logger.debug("cart.afterAdd", { sessionId: cart.sessionId, itemCount: cart.items.length, total: cart.total, discount: cart.discount, freeShipping: cart.freeShipping });

      let crossSellSuggestions: CrossSellSuggestion[] = [];
      let crossSellDisplayMode: string | undefined;
      try {
        const crossSellConfig = await deps.loadCrossSellConfig(ctx.merchantId);
        if (crossSellConfig.enabled && crossSellConfig.touchpoints.pre_cart) {
          crossSellSuggestions = await buildCrossSellSuggestions(
            { productRepo: deps.productRepo, prisma: deps.prisma, listEligibleCrossSells: deps.listEligibleCrossSells },
            ctx.merchantId,
            cart,
            crossSellConfig,
            productName,
          );
          crossSellDisplayMode = crossSellConfig.display?.mode;
        }
      } catch { }

      return {
        cartId: cart.sessionId,
        items: cart.items.map(toCartLineDto),
        total: cart.total / 100,
        discount: cart.discount / 100,
        freeShipping: cart.freeShipping,
        itemCount: cart.items.reduce((sum, i) => sum + i.quantity, 0),
        nextNudge: nextNudge ?? undefined,
        activeRules: activeRules && activeRules.length > 0 ? activeRules : undefined,
        crossSellSuggestions: crossSellSuggestions.length > 0 ? crossSellSuggestions : undefined,
        crossSellDisplayMode: crossSellSuggestions.length > 0 ? crossSellDisplayMode : undefined,
      };
    },

    getCart: async (args) => {
      const cart = await deps.cartRepo.getOrCreate(ctx.merchantId, args.cartId || ctx.sessionId);
      return {
        cartId: cart.sessionId,
        items: cart.items.map(toCartLineDto),
        total: cart.total / 100,
        discount: cart.discount / 100,
        freeShipping: cart.freeShipping,
        couponCode: cart.couponCode,
        itemCount: cart.items.reduce((sum, i) => sum + i.quantity, 0)
      };
    },

    removeCartItem: async (args) => {
      const removed = await deps.cartRepo.removeItem(ctx.merchantId, args.cartId, args.variantId);
      const { cart, nextNudge, activeRules } = await reevaluateCartRules(deps, ctx.merchantId, args.cartId, removed);
      return {
        cartId: cart.sessionId,
        items: cart.items.map(toCartLineDto),
        total: cart.total / 100,
        discount: cart.discount / 100,
        freeShipping: cart.freeShipping,
        itemCount: cart.items.reduce((sum, i) => sum + i.quantity, 0),
        nextNudge: nextNudge ?? undefined,
        activeRules: activeRules && activeRules.length > 0 ? activeRules : undefined,
      };
    },

    updateCartItem: async (args) => {
      const updated = await deps.cartRepo.updateItemQuantity(ctx.merchantId, args.cartId, args.variantId, args.quantity);
      const { cart, nextNudge, activeRules } = await reevaluateCartRules(deps, ctx.merchantId, args.cartId, updated);
      return {
        cartId: cart.sessionId,
        items: cart.items.map(toCartLineDto),
        total: cart.total / 100,
        discount: cart.discount / 100,
        freeShipping: cart.freeShipping,
        itemCount: cart.items.reduce((sum, i) => sum + i.quantity, 0),
        nextNudge: nextNudge ?? undefined,
        activeRules: activeRules && activeRules.length > 0 ? activeRules : undefined,
      };
    },

    clearCart: async (args) => {
      const cart = await deps.cartRepo.clear(ctx.merchantId, args.cartId);
      return { cartId: cart.sessionId, items: [], total: 0, itemCount: 0 };
    },

    quoteShipping: async (args) => {
      let totalWeight = 300;

      if (args.cartId) {
        const cart = await deps.cartRepo.getOrCreate(ctx.merchantId, args.cartId);
        totalWeight = cart.items.length > 0 ? cart.items.length * 300 : 300;
      }

      if ((args as any).productId) {
        try {
          const product = await deps.productRepo.findById(ctx.merchantId, (args as any).productId);
          if (product?.variants?.[0]?.weightGrams) {
            totalWeight = product.variants[0].weightGrams;
          }
        } catch { }
      }

      const sedexPrice = Math.max(1500, Math.round(totalWeight * 0.5) + 800);
      const pacPrice = Math.max(800, Math.round(totalWeight * 0.3) + 400);
      return {
        options: [
          { carrier: "Sedex", name: "Sedex", price: sedexPrice, days: 2, zipCode: args.zipCode },
          { carrier: "PAC", name: "PAC", price: pacPrice, days: 7, zipCode: args.zipCode }
        ]
      };
    },

    applyCoupon: async (args) => {
      const sessionId = args.cartId || ctx.sessionId;
      const cart = await deps.cartRepo.getOrCreate(ctx.merchantId, sessionId);
      if (cart.items.length === 0) {
        return { applied: false, reason: "cart_empty" };
      }
      const code = args.couponCode.toUpperCase().trim();

      if (!deps.applyCouponUseCase) {
        logger.warn("cart.applyCoupon.useCase_missing", { merchantId: ctx.merchantId, code });
        return { applied: false, reason: "coupon_service_unavailable" };
      }

      const merchantRules = await deps.merchantRepo.getRules(ctx.merchantId);
      if (!merchantRules) {
        return { applied: false, reason: "merchant_rules_unavailable" };
      }

      const engineCart: Cart = {
        currency: "BRL",
        total: cart.total / 100,
        items: cart.items.map((i) => ({
          sku: i.sku,
          name: i.name,
          price: i.unitPriceCents / 100,
          quantity: i.quantity,
          category: (i as { category?: string }).category,
        })) as Cart["items"],
        source: "storefront",
      };

      try {
        const result = await deps.applyCouponUseCase.execute({
          merchant_id: ctx.merchantId,
          session_id: sessionId,
          code,
          cart: engineCart,
          merchantRules,
          source: "manual",
        });
        const discountCents = Math.round((result.discount_applied ?? 0) * 100);
        const updated = await deps.cartRepo.applyCoupon(ctx.merchantId, sessionId, code, discountCents);
        logger.debug("cart.applyCoupon.applied", { merchantId: ctx.merchantId, sessionId, code, discountCents });
        return {
          applied: true,
          couponCode: code,
          discountCents,
          discount: discountCents / 100,
          newTotal: (updated.total - discountCents) / 100,
          reason: "success",
          cartId: updated.sessionId,
          items: updated.items.map(toCartLineDto),
          total: updated.total / 100,
          itemCount: updated.items.reduce((sum, i) => sum + i.quantity, 0),
        };
      } catch (err) {
        const reason = err instanceof Error ? (err.message || "coupon_invalid") : "coupon_invalid";
        logger.log("cart.applyCoupon.rejected " + JSON.stringify({ merchantId: ctx.merchantId, sessionId, code, reason }));
        return { applied: false, reason };
      }
    },

    listPromotions: async (_args) => {
      const now = Date.now();

      // 1. Active coupons (real, from the coupon repo — never invented)
      let coupons: Array<{ code: string; type: string; value: number; description: string; minCartValue?: number; expiresAt: string | null }> = [];
      if (deps.couponRepo) {
        try {
          const rows = await deps.couponRepo.findAllByMerchant(ctx.merchantId);
          coupons = rows
            .map((c) => c.snapshot())
            .filter((s) => s.status === "active")
            .filter((s) => !s.starts_at || new Date(s.starts_at).getTime() <= now)
            .filter((s) => !s.ends_at || new Date(s.ends_at).getTime() > now)
            .filter((s) => s.max_usages === null || s.usages_count < s.max_usages)
            .map((s) => {
              const typeLabel =
                s.discount_type === "percent" ? `${s.discount_value}% de desconto`
                : s.discount_type === "fixed" ? `${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(s.discount_value)} de desconto`
                : s.discount_type.startsWith("shipping") ? "Frete grátis"
                : "Desconto";
              return {
                code: s.code,
                type: s.discount_type,
                value: s.discount_value,
                description: typeLabel,
                minCartValue: s.min_cart_total ?? undefined, // reais, not cents
                expiresAt: s.ends_at ?? null,
              };
            });
        } catch (err) {
          logger.warn("cart.listPromotions.coupons_failed " + (err instanceof Error ? err.message : String(err)));
        }
      } else {
        logger.warn("cart.listPromotions.couponRepo_missing", { merchantId: ctx.merchantId });
      }

      // 2. Progressive discount (from checkout_settings.interventionPolicy) — only when
      //    the merchant's progressive mode allows advertising it (not coupon_only).
      let progressive: { maxPercent: number; description: string } | undefined;
      try {
        const setting = await deps.prisma.checkoutSetting.findUnique({
          where: { merchantId: ctx.merchantId },
          select: { interventionPolicy: true },
        });
        const pd = (setting?.interventionPolicy as { progressiveDiscount?: { enabled?: boolean; maxProgressivePercent?: number; mode?: string } } | null)?.progressiveDiscount;
        const merchantRules = await deps.merchantRepo.getRules(ctx.merchantId).catch(() => null);
        const maxDiscount = Number(merchantRules?.maxDiscountPercent ?? 0) || 100;
        if (pd?.enabled && (pd.maxProgressivePercent ?? 0) > 0 && pd.mode !== "coupon_only") {
          const capped = Math.min(pd.maxProgressivePercent ?? 0, maxDiscount);
          if (capped > 0) {
            progressive = { maxPercent: capped, description: `Desconto progressivo de até ${capped}% ao concluir a compra` };
          }
        }
      } catch (err) {
        logger.warn("cart.listPromotions.progressive_failed " + (err instanceof Error ? err.message : String(err)));
      }

      // 3. Advanced cart rules (enabled) — surface their labels so the buyer knows
      //    e.g. "compre 2 leve 3", tiered discounts. loadAdvancedRules already filters enabled.
      let advancedRules: Array<{ label: string }> = [];
      try {
        const rules = await loadAdvancedRules(deps.prisma, ctx.merchantId);
        advancedRules = rules
          .map((r) => {
            const anyR = r as unknown as { label?: string; name?: string; description?: string };
            const label = anyR.label || anyR.name || anyR.description;
            return label ? { label } : null;
          })
          .filter((x): x is { label: string } => x !== null);
      } catch (err) {
        logger.warn("cart.listPromotions.advancedRules_failed " + (err instanceof Error ? err.message : String(err)));
      }

      // `promotions` kept for backward compatibility (coupons only); new consumers read coupons/progressive/advancedRules.
      return { promotions: coupons, coupons, progressive, advancedRules };
    },

    removeCoupon: async (args) => {
      const cart = await deps.cartRepo.removeCoupon(ctx.merchantId, args.cartId);
      return {
        cartId: cart.sessionId,
        total: cart.total,
        discount: 0,
        couponCode: null
      };
    },

    createCheckoutSession: async (args) => {
      const cartId = args.cartId || ctx.sessionId;

      // Fetch current cart from storefront to pass to checkout creation
      let cart = null;
      try {
        cart = await deps.cartRepo.getOrCreate(ctx.merchantId, cartId);
      } catch (err) {
        logger.warn("checkout.cart_fetch_failed", { merchantId: ctx.merchantId, cartId });
      }

      // Create checkout session via API (StartCheckoutUseCase)
      // The use-case will create a fresh session + initialize with cart data
      try {
        const response = await fetch("http://localhost:3009/checkout/start-checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            merchant_id: ctx.merchantId,
            cart_id: cartId
            // Note: StartCheckout will resolve buyer + cart internally
          })
        });
        if (!response.ok) {
          logger.warn("checkout.start_failed", { status: response.status, cartId });
        } else {
          const result = await response.json();
          const widgetBaseUrl = process.env.WIDGET_BASE_URL ?? "http://localhost:5173";
          const checkoutUrl = `${widgetBaseUrl}/embed/checkout/${result.session_id}?cartId=${cartId}`;
          return { checkoutUrl, sessionId: result.session_id };
        }
      } catch (err) {
        logger.warn("checkout.start_error", { error: err instanceof Error ? err.message : String(err) });
      }

      // Fallback: return simple redirect (won't have cart synced, but won't crash)
      const sessionId = `chk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const widgetBaseUrl = process.env.WIDGET_BASE_URL ?? "http://localhost:5173";
      const checkoutUrl = `${widgetBaseUrl}/embed/checkout/${sessionId}?cartId=${cartId}`;
      logger.warn("checkout.fallback_session", { sessionId, cartId, itemCount: cart?.items?.length || 0 });
      return { checkoutUrl, sessionId };
    }
  };
}
