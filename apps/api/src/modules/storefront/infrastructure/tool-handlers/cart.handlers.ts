import type { StoreToolHandlers } from "../../domain/tools/types.js";
import type { ToolRequestContext } from "../../domain/tools/tool-context.js";
import type { ProductRepositoryPort, StockRepositoryPort } from "../../../catalog/domain/ports/product-repository.port.js";
import type { StorefrontCartPort, StorefrontCartSelectedOption } from "../../domain/ports/storefront-cart.port.js";
import type { ProductPromotionRepositoryPort } from "../../../catalog/domain/ports/product-promotion-repository.port.js";
import { extractOptionGroups, resolveSelectedOptions, FoodOptionValidationError } from "../../domain/food-options.js";
import type { ListEligibleCrossSellsUseCase } from "../../../cross-sell/application/use-cases/list-eligible-cross-sells.use-case.js";
import type { CrossSellPromotionRepository } from "../../../cross-sell/domain/ports/cross-sell-promotion-repository.port.js";
import type { ApplyCouponUseCase } from "../../../coupons/application/use-cases/apply-coupon.use-case.js";
import type { CouponRepository } from "../../../coupons/domain/ports/coupon-repository.port.js";
import type { Cart } from "@zyon/shared-types";
import type { SearchMarketplaceProductsStorefrontUseCase, FederatedProductResponse } from "../../application/use-cases/search-marketplace-products-storefront.use-case.js";
import type { AddMarketplaceItemToCartStorefrontUseCase } from "../../application/use-cases/add-marketplace-item-to-cart.use-case.js";
import type { PrismaClient } from "@prisma/client";
import type { MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import type { OneBuyClickSessionService } from "../../application/services/one-buy-click-session.service.js";
import { Logger } from "@nestjs/common";
import { buildCrossSellSuggestions, type CrossSellConfig, type CrossSellSuggestion } from "./cart-cross-sell.helper.js";
import { CartRulesEngine, buildCartRuleContext } from "../../domain/services/cart-rules-engine.service.js";
import { RuleProximityEngine, type RuleNudge, type ActiveRuleBadge } from "../../domain/services/rule-proximity.service.js";
import type { AdvancedRule } from "../../../checkout/domain/services/advanced-rule-evaluator.service.js";
import type { StorefrontCart } from "../../domain/ports/storefront-cart.port.js";
import { applyProductPromoPricing, type ProductPromoMeta } from "../pricing/storefront-cart-promo.pricing.js";
import { validateFoodOptionGroups } from "../../../catalog/domain/services/food-options-validation.js";
import { resolveSelectedServiceSlot, ServiceSlotError, serviceSlotLabel, type SelectedServiceSlot } from "../../../catalog/domain/services/service-schedule.js";
import type { BillingPlanMeteringService } from "../../../payment/domain/billing-plan-guard.js";

const logger = new Logger("CartHandlers");

const cartRulesEngine = new CartRulesEngine();
const ruleProximityEngine = new RuleProximityEngine();

interface CartRulesOutcome {
  cart: StorefrontCart;
  nextNudge?: RuleNudge | null;
  activeRules?: ActiveRuleBadge[];
  promoMeta?: ProductPromoMeta;
}

async function loadAdvancedRules(prisma: PrismaClient, merchantId: string, billing?: BillingPlanMeteringService): Promise<AdvancedRule[]> {
  try {
    // Rules stay persisted after a downgrade for a future reactivation, but
    // they must not change price, shipping or buyer messaging while disabled.
    await billing?.assertAllowed(merchantId, { kind: "feature", key: "advancedRules" });
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
  deps: Pick<CartHandlerDeps, "prisma" | "merchantRepo" | "cartRepo" | "productPromotionRepo" | "billing">,
  merchantId: string,
  sessionId: string,
  cart: StorefrontCart,
): Promise<CartRulesOutcome> {
  if (cart.items.some(line => line.marketplace)) {
    const promoMeta = await applyProductPromoPricing(deps.productPromotionRepo, merchantId, cart);
    return { cart, promoMeta, nextNudge: null, activeRules: [] };
  }
  try {
    // Product promotions adjust each LINE price first (from the original base
    // price, idempotently), so the cart-level rules engine evaluates on the
    // promo-adjusted subtotal.
    const initialPromoMeta = await applyProductPromoPricing(deps.productPromotionRepo, merchantId, cart);

    const advancedRules = await loadAdvancedRules(deps.prisma, merchantId, deps.billing);
    const merchantRules = advancedRules.length > 0 ? await deps.merchantRepo.getRules(merchantId) : null;

    // No cart-level rules → still return the promo-adjusted cart (+ badge meta).
    if (advancedRules.length === 0 || !merchantRules) {
      if (!cart.couponCode && (cart.discount || cart.freeShipping)) {
        const clean = await deps.cartRepo.applyRuleOutcome(merchantId, sessionId, { discountCents: 0, freeShipping: false });
        const promoMeta = await applyProductPromoPricing(deps.productPromotionRepo, merchantId, clean);
        return { cart: clean, promoMeta, nextNudge: null, activeRules: [] };
      }
      return { cart, promoMeta: initialPromoMeta, nextNudge: null, activeRules: [] };
    }
    const categoriesInCart = cart.items
      .map((i) => i.categoryId ?? "")
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
      discountCents: cart.couponCode ? cart.discount : outcome.discountCents,
      freeShipping: outcome.freeShipping,
    });

    // applyRuleOutcome re-reads the cart from the DB with ORIGINAL line prices,
    // so re-apply product-promo pricing to the persisted cart before returning.
    const promoMeta = await applyProductPromoPricing(deps.productPromotionRepo, merchantId, persisted);

    const hadEffect = (!cart.couponCode && outcome.discountCents > 0) || outcome.freeShipping === true;
    const effectiveRuleId = hadEffect ? outcome.appliedRuleId : undefined;
    const noticeRules = advancedRules.filter((rule) => rule.action.type !== "offer_free_shipping" || merchantRules.allowFreeShipping !== false)
      .map((rule) => rule.action.type === "offer_discount" ? {
        ...rule, action: { ...rule.action, params: { ...rule.action.params, percent: Math.min(Number(rule.action.params.percent), merchantRules.maxDiscountPercent) } },
      } : rule);
    const proximity = ruleProximityEngine.compute(noticeRules, buildCartRuleContext(persisted, { categoriesInCart }), effectiveRuleId, { discountCents: cart.couponCode ? 0 : outcome.discountCents, freeShipping: outcome.freeShipping });
    return { cart: persisted, nextNudge: proximity.nextNudge, activeRules: proximity.active, promoMeta };
  } catch (err) {
    logger.warn("cart.reevaluateRules.failed", {
      merchantId,
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { cart };
  }
}

function toCartLineDto(
  i: {
    variantId: string;
    name: string;
    quantity: number;
    unitPriceCents: number;
    imageUrl?: string;
    selectedOptions?: StorefrontCartSelectedOption[];
    selectedServiceSlot?: SelectedServiceSlot;
    marketplace?: StorefrontCart["items"][number]["marketplace"];
  },
  meta?: ProductPromoMeta,
) {
  const badge = meta?.get(i.variantId);
  return {
    variantId: i.variantId,
    name: i.name,
    quantity: i.quantity,
    unitPrice: i.unitPriceCents / 100,
    lineTotal: (i.unitPriceCents * i.quantity) / 100,
    imageUrl: i.imageUrl,
    ...(i.marketplace ? { seller: { merchantId: i.marketplace.sellerMerchantId, name: i.marketplace.sellerName } } : {}),
    // Promo badge metadata (present only when an active product promotion applied).
    ...(badge
      ? {
          originalPrice: badge.originalPriceCents / 100,
          discountPercent: badge.discountPercent,
          coupon: badge.coupon,
        }
      : {}),
    ...(i.selectedServiceSlot ? { selectedServiceSlot: i.selectedServiceSlot } : {}),
    selectedOptions: i.selectedOptions?.length || i.selectedServiceSlot ? [...(i.selectedOptions ?? []).map((o) => ({
      groupName: o.groupName,
      itemName: o.itemName,
      priceModifier: o.priceModifierInCents / 100,
    })), ...(i.selectedServiceSlot ? [{ groupName: "Horário selecionado", itemName: serviceSlotLabel(i.selectedServiceSlot), priceModifier: 0 }] : [])] : undefined,
  };
}

export interface CartHandlerDeps {
  productRepo: ProductRepositoryPort;
  stockRepo: StockRepositoryPort;
  cartRepo: StorefrontCartPort;
  prisma: PrismaClient;
  merchantRepo: MerchantRepository;
  searchMarketplaceProducts?: SearchMarketplaceProductsStorefrontUseCase;
  /**
   * Cross-store add: when a federated (other-store) product is added, this
   * use-case creates the cross_store_line_items row with frozen commission so
   * PlaceCrossStoreOrder can build settlements at checkout. When absent,
   * marketplace addition fails closed; it never falls into the local writer.
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
  /**
   * Product promotion repository — for resolving active product-level promos
   * before cart-rules evaluation. Optional: when absent, no product promos apply.
   */
  productPromotionRepo?: ProductPromotionRepositoryPort;
  billing?: BillingPlanMeteringService;
  oneBuyClick?: OneBuyClickSessionService;
}

function selectableVariants(product: NonNullable<Awaited<ReturnType<ProductRepositoryPort["findById"]>>>): Array<{ id: string; sku: string; attributes: Record<string, string>; basePriceInCents: number; media: Array<{ url: string }> }> {
  return product.variants.filter((variant) => variant.isActive);
}

function variationSelection(product: NonNullable<Awaited<ReturnType<ProductRepositoryPort["findById"]>>>) {
  return {
    productId: product.id,
    productName: product.name,
    variants: selectableVariants(product).map((variant) => ({
      id: variant.id,
      label: variantLabel(variant.attributes, variant.sku),
    })),
  };
}

function variantLabel(attributes: Record<string, string>, fallback: string): string {
  const values = Object.values(attributes).filter(Boolean);
  return values.length > 0 ? values.join(" · ") : fallback;
}

export function createCartHandlers(deps: CartHandlerDeps, ctx: ToolRequestContext): Pick<StoreToolHandlers, "addItemToCart" | "getCart" | "removeCartItem" | "updateCartItem" | "clearCart" | "quoteShipping" | "applyCoupon" | "removeCoupon" | "listPromotions" | "createCheckoutSession"> {
  return {
    addItemToCart: async (args) => {
      if (!Number.isSafeInteger(args.quantity) || args.quantity < 1 || args.quantity > 99) return { error: "cart_quantity_invalid" };
      const sessionId = ctx.sessionId || `cart_${Date.now()}`;

      logger.debug("cart.addItem", { merchantId: ctx.merchantId, sessionId, variantId: args.variantId, qty: args.quantity });

      let productName = "Produto";
      let unitPriceCents = 0;
      let imageUrl: string | undefined;
      let resolvedVariantId = args.variantId;
      // Real SKU + productId of the resolved variant — needed so cart lines carry
      // the true SKU (not the variantId) for promo lookup + product_in_cart rules.
      let resolvedSku: string | undefined;
      let resolvedProductId: string | undefined;
      let resolvedProduct: Awaited<ReturnType<typeof deps.productRepo.findById>> | null = null;
      // Cross-store: set when the resolved product is federated (another store's).
      let marketplaceProduct: FederatedProductResponse | undefined;
      // The public tool accepts one product binding, not a client-supplied
      // marketplace tuple. Never ignore a foreign hint and add another item.
      const supplied = args as unknown as Record<string, unknown>;
      const unsupportedMarketplaceBinding = ["sourceVariantId", "source_variant_id", "federatedProductId", "federated_product_id",
        "sellerMerchantId", "seller_merchant_id"].some(key => Object.prototype.hasOwnProperty.call(supplied, key));

      try {
        let exactVariant: { productId: string } | null = null;
        try {
          exactVariant = await deps.prisma.productVariant.findFirst({
            where: {
              isActive: true,
              OR: [{ id: args.variantId }, { sku: args.variantId }],
              product: { merchantId: ctx.merchantId, isActive: true, deletedAt: null },
            },
            select: { productId: true },
          });
        } catch {
          // Catalog search below remains the compatibility fallback when the
          // exact-variant index is unavailable during a rolling deployment.
        }
        let product = exactVariant
          ? await deps.productRepo.findById(ctx.merchantId, exactVariant.productId)
          : null;
        let foundVariant = product?.variants.find((variant) => variant.id === args.variantId || variant.sku === args.variantId) ?? null;

        const searchResult = await deps.productRepo.search({ merchantId: ctx.merchantId, limit: 20, isActiveOnly: true });
        product = product ?? searchResult.products.find(p =>
          p.variants.some(v => v.id === args.variantId || v.sku === args.variantId)
        ) ?? null;

        if (product) {
          foundVariant = foundVariant ?? product.variants.find(v => v.id === args.variantId || v.sku === args.variantId) ?? null;
          if (foundVariant) {
            resolvedProduct = product;
            productName = product.name;
            resolvedVariantId = foundVariant.id;
            resolvedSku = foundVariant.sku;
            resolvedProductId = product.id;
            unitPriceCents = foundVariant.basePriceInCents;
            imageUrl = foundVariant.media?.[0]?.url;
          }
        }

        if (!foundVariant) {
          product = await deps.productRepo.findById(ctx.merchantId, args.variantId);
          if (product) {
            resolvedProduct = product;
            productName = product.name;
            const variants = selectableVariants(product);
            if (variants.length === 1) {
              const [variant] = variants;
              resolvedVariantId = variant.id;
              resolvedSku = variant.sku;
              resolvedProductId = product.id;
              unitPriceCents = variant.basePriceInCents;
              imageUrl = variant.media?.[0]?.url;
            } else {
              return {
                error: "variant_selection_required",
                variantSelection: variationSelection(product),
              };
            }
          }
        }

        // Last-resort resolution by PRODUCT ID or NAME against the catalog. The
        // LLM sometimes passes the product id (not a variant id) or even the
        // product NAME as `variantId` (e.g. "RTP-PRODUCT-001") — a known
        // model-reliability gap. Rather than reject a real, in-catalog product,
        // match it deterministically only when there is exactly one sellable
        // variant. Price is still taken server-side from the resolved variant.
        if (!foundVariant && unitPriceCents === 0) {
          const needle = (args.variantId ?? "").trim().toLowerCase();
          const byIdOrName = searchResult.products.find(p =>
            p.id === args.variantId || p.name.trim().toLowerCase() === needle,
          );
          const variants = byIdOrName ? selectableVariants(byIdOrName) : [];
          if (byIdOrName && variants.length === 1) {
            const [variant] = variants;
            resolvedProduct = byIdOrName;
            productName = byIdOrName.name;
            resolvedVariantId = variant.id;
            resolvedSku = variant.sku;
            resolvedProductId = byIdOrName.id;
            unitPriceCents = variant.basePriceInCents;
            imageUrl = variant.media?.[0]?.url;
          } else if (byIdOrName) {
            return {
              error: "variant_selection_required",
              variantSelection: variationSelection(byIdOrName),
            };
          }
        }

        if (unitPriceCents === 0 && deps.searchMarketplaceProducts) {
          try {
            marketplaceProduct = await deps.searchMarketplaceProducts.resolveById({ merchantId: ctx.merchantId, federatedProductId: args.variantId });
          } catch { return { error: "marketplace_catalog_unavailable" }; }
        }
      } catch {
      }

      if (marketplaceProduct) {
        // An LLM-provided variant/tag is not the buyer's selection. Multi-option
        // products always return the canonical card; its signed REST add is the
        // only route that accepts the buyer's explicit marketplace choice.
        if (marketplaceProduct.variants.length !== 1) {
          ctx.marketplaceVariantSelectionPending = true;
          return { error: "marketplace_variant_selection_required", marketplaceProduct };
        }
        if (unsupportedMarketplaceBinding) {
          ctx.marketplaceVariantSelectionPending = true;
          return { error: "marketplace_tool_binding_invalid" };
        }
        if (!deps.addMarketplaceItemToCart) return { error: "marketplace_cart_unavailable" };
        if (args.crossSellPromoId || args.selectedOptionItemIds?.length || args.selectedServiceSlotId) return { error: "marketplace_product_options_required" };
        if (!marketplaceProduct.inStock || !marketplaceProduct.variants[0].inStock) return { error: "marketplace_insufficient_stock", marketplaceProduct };
        let result;
        try {
          // Retain writer admission for a single active variant. Passing an ID
          // selected by this stale read could accept a newly ambiguous product.
          result = await deps.addMarketplaceItemToCart.execute({ merchantId: ctx.merchantId, checkoutSessionId: sessionId,
            sellerMerchantId: marketplaceProduct.sellerId, federatedProductId: marketplaceProduct.id, quantity: args.quantity });
        } catch (error) {
          if (error instanceof Error && error.message === "marketplace_variant_selection_required") {
            ctx.marketplaceVariantSelectionPending = true;
            let refreshed: FederatedProductResponse | undefined;
            try { refreshed = await deps.searchMarketplaceProducts?.resolveById({ merchantId: ctx.merchantId, federatedProductId: marketplaceProduct.id }); }
            catch { return { error: "marketplace_catalog_unavailable" }; }
            return refreshed ? { error: "marketplace_variant_selection_required", marketplaceProduct: refreshed }
              : { error: "marketplace_catalog_unavailable" };
          }
          throw error;
        }
        const cart = result.cart;
        return { cartId: cart.sessionId, items: cart.items.map(line => toCartLineDto(line)),
          addedItem: { variantId: cart.items.find(line => line.marketplace?.federatedProductId === marketplaceProduct.id)?.variantId },
          total: cart.total / 100, discount: cart.discount / 100, freeShipping: cart.freeShipping,
          itemCount: cart.items.reduce((sum, line) => sum + line.quantity, 0) };
      }

      if (unsupportedMarketplaceBinding) {
        ctx.marketplaceVariantSelectionPending = true;
        return { error: "marketplace_tool_binding_invalid" };
      }
      if (unitPriceCents === 0 && !resolvedProduct) return {
        error: deps.searchMarketplaceProducts ? "variant_not_resolved" : "marketplace_catalog_unavailable",
        detail: "Não encontrei uma associação válida de produto para adicionar ao carrinho.",
      };

      if (resolvedProduct?.type !== "digital" && resolvedProduct?.type !== "service") {
        try {
          const existingCart = await deps.cartRepo.getOrCreate(ctx.merchantId, sessionId);
          const requestedQuantity = args.quantity + existingCart.items.filter(i => i.variantId === resolvedVariantId).reduce((n, i) => n + i.quantity, 0);
          const stock = await deps.stockRepo.getAvailableStock(resolvedVariantId);
          const availableQuantity = Math.max(0, stock.quantity - stock.reserved);
          if (!Number.isFinite(availableQuantity) || availableQuantity < requestedQuantity) {
            logger.warn("cart.stock.insufficient", { variantId: resolvedVariantId, requestedQuantity, availableQuantity });
            return { error: "variant_out_of_stock", detail: "A variacao escolhida nao possui estoque suficiente." };
          }
        } catch {
          return { error: "stock_validation_unavailable", detail: "Nao foi possivel validar o estoque agora." };
        }
      }

      // Food option groups: validate the buyer's selection against the product's
      // stored groups and re-compute the price modifier server-side. The client
      // never dictates price (deterministic offer-math). A missing required
      // group, an unknown item id, or multiple picks in a single-select group is
      // rejected rather than silently priced wrong.
      let selectedOptions: StorefrontCartSelectedOption[] | undefined;
      let selectedServiceSlot: SelectedServiceSlot | undefined;
      try {
        if (resolvedProduct?.type === "service") selectedServiceSlot = resolveSelectedServiceSlot(resolvedProduct.metadata, args.selectedServiceSlotId);
        else if (args.selectedServiceSlotId) return { error: "service_slot_unknown" };
      } catch (error) {
        if (error instanceof ServiceSlotError) return { error: error.code };
        throw error;
      }
      if (validateFoodOptionGroups(resolvedProduct?.metadata?.optionGroups)) return { error: "food_option_configuration_invalid" };
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
              if (!snapRecommendedSkus.has((resolvedSku ?? "").toLowerCase()) && !snapRecommendedSkus.has(resolvedVariantId.toLowerCase()) && !snapRecommendedSkus.has((args.variantId ?? "").toLowerCase())) {
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
        productId: resolvedProductId ?? args.variantId,
        categoryId: resolvedProduct?.categoryId,
        name: productName,
        sku: resolvedSku ?? resolvedVariantId,
        unitPriceCents,
        imageUrl,
        quantity: args.quantity,
        selectedOptions,
        ...(selectedServiceSlot ? { selectedServiceSlot } : {}),
      });

      const { cart, nextNudge, activeRules, promoMeta } = await reevaluateCartRules(deps, ctx.merchantId, sessionId, addedCart);
      logger.debug("cart.afterAdd", { sessionId: cart.sessionId, itemCount: cart.items.length, total: cart.total, discount: cart.discount, freeShipping: cart.freeShipping });

      let crossSellSuggestions: CrossSellSuggestion[] = [];
      let crossSellDisplayMode: string | undefined;
      try {
        const crossSellConfig = await deps.loadCrossSellConfig(ctx.merchantId);
        if (crossSellConfig.enabled && crossSellConfig.touchpoints.post_cart) {
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
        items: cart.items.map((i) => toCartLineDto(i, promoMeta)),
        addedItem: { variantId: resolvedVariantId, serviceSlotId: selectedServiceSlot?.slotId,
          optionItemIds: (selectedOptions ?? []).map(option => option.itemId) },
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
      const base = await deps.cartRepo.getOrCreate(ctx.merchantId, ctx.sessionId);
      const { cart, promoMeta, nextNudge, activeRules } = await reevaluateCartRules(deps, ctx.merchantId, ctx.sessionId, base);
      return {
        cartId: cart.sessionId,
        items: cart.items.map((i) => toCartLineDto(i, promoMeta)),
        total: cart.total / 100,
        discount: cart.discount / 100,
        freeShipping: cart.freeShipping,
        couponCode: cart.couponCode,
        nextNudge,
        activeRules,
        itemCount: cart.items.reduce((sum, i) => sum + i.quantity, 0)
      };
    },

    removeCartItem: async (args) => {
      const removed = await deps.cartRepo.removeItem(ctx.merchantId, ctx.sessionId, args.variantId);
      const { cart, nextNudge, activeRules, promoMeta } = await reevaluateCartRules(deps, ctx.merchantId, ctx.sessionId, removed);
      return {
        cartId: cart.sessionId,
        items: cart.items.map((i) => toCartLineDto(i, promoMeta)),
        total: cart.total / 100,
        discount: cart.discount / 100,
        freeShipping: cart.freeShipping,
        itemCount: cart.items.reduce((sum, i) => sum + i.quantity, 0),
        nextNudge: nextNudge ?? undefined,
        activeRules: activeRules && activeRules.length > 0 ? activeRules : undefined,
      };
    },

    updateCartItem: async (args) => {
      if (!Number.isSafeInteger(args.quantity) || args.quantity < 0 || args.quantity > 99) return { error: "cart_quantity_invalid" };
      const current = await deps.cartRepo.getOrCreate(ctx.merchantId, ctx.sessionId);
      const lines = current.items.filter(i => i.variantId === args.variantId);
      if (!lines.length) return { error: "cart_item_not_found" };
      if (args.quantity > 0 && lines.length > 1) return { error: "cart_option_line_selection_required" };
      const product = args.quantity > 0 && !lines[0]!.marketplace ? await deps.productRepo.findById(ctx.merchantId, lines[0]!.productId) : null;
      if (args.quantity > 0 && !lines[0]!.marketplace && (!product || !product.isActive || !product.variants.some(v => v.id === args.variantId && v.isActive))) return { error: "product_unavailable" };
      if (args.quantity > 0 && product && product.type !== "digital" && product.type !== "service") {
        try {
          const stock = await deps.stockRepo.getAvailableStock(args.variantId);
          const available = Math.max(0, stock.quantity - stock.reserved);
          if (!Number.isFinite(available) || args.quantity > available) return { error: "variant_out_of_stock", detail: "A variação escolhida não possui estoque suficiente." };
        } catch { return { error: "stock_validation_unavailable", detail: "Não foi possível validar o estoque agora." }; }
      }
      const updated = await deps.cartRepo.updateItemQuantity(ctx.merchantId, ctx.sessionId, args.variantId, args.quantity);
      const { cart, nextNudge, activeRules, promoMeta } = await reevaluateCartRules(deps, ctx.merchantId, ctx.sessionId, updated);
      return {
        cartId: cart.sessionId,
        items: cart.items.map((i) => toCartLineDto(i, promoMeta)),
        total: cart.total / 100,
        discount: cart.discount / 100,
        freeShipping: cart.freeShipping,
        itemCount: cart.items.reduce((sum, i) => sum + i.quantity, 0),
        nextNudge: nextNudge ?? undefined,
        activeRules: activeRules && activeRules.length > 0 ? activeRules : undefined,
      };
    },

    clearCart: async (args) => {
      const cart = await deps.cartRepo.clear(ctx.merchantId, ctx.sessionId);
      return { cartId: cart.sessionId, items: [], total: 0, itemCount: 0 };
    },

    quoteShipping: async (args) => {
      let totalWeight = 300;
      if ((args as any).productId) {
        const product = await deps.productRepo.findById(ctx.merchantId, (args as any).productId);
        if (!product?.isActive) return { options: [], reason: "product_unavailable" };
        if (product.type === "digital" || product.type === "service") return { options: [], reason: "shipping_not_required" };
        totalWeight = product.variants.find(v => v.isActive)?.weightGrams ?? 300;
      } else if (ctx.sessionId) {
        const cart = await deps.cartRepo.getOrCreate(ctx.merchantId, ctx.sessionId);
        if (cart.items.length) {
          const variants = await deps.prisma.productVariant.findMany({
            where: { sku: { in: cart.items.map(item => item.sku) }, product: { merchantId: ctx.merchantId, deletedAt: null } },
            select: { sku: true, weightGrams: true, product: { select: { type: true } } },
          });
          const bySku = new Map(variants.map(v => [v.sku, v]));
          const physical = cart.items.filter(item => !["digital", "service"].includes(bySku.get(item.sku)?.product.type ?? "physical"));
          if (!physical.length) return { options: [], reason: "shipping_not_required" };
          totalWeight = physical.reduce((sum, item) => sum + (bySku.get(item.sku)?.weightGrams ?? 300) * item.quantity, 0);
        }
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
      const sessionId = ctx.sessionId;
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
          category: i.categoryId,
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
          items: updated.items.map((i) => toCartLineDto(i)),
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
        const rules = await loadAdvancedRules(deps.prisma, ctx.merchantId, deps.billing);
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
      const cart = await deps.cartRepo.removeCoupon(ctx.merchantId, ctx.sessionId);
      return {
        cartId: cart.sessionId,
        total: cart.total,
        discount: 0,
        couponCode: null
      };
    },

    createCheckoutSession: async (args) => {
      if (ctx.marketplaceVariantSelectionPending) return { error: "marketplace_variant_selection_required" };
      if (ctx.oneBuyClick?.enabled && deps.oneBuyClick) {
        const cart = await deps.cartRepo.getOrCreate(ctx.merchantId, ctx.sessionId);
        if (cart.items.length === 0) return { error: "checkout_cart_empty" };

        const cartFingerprint = JSON.stringify({
          discount: cart.discount,
          freeShipping: cart.freeShipping,
          items: cart.items
            .map((item) => ({ variantId: item.variantId, quantity: item.quantity, unitPriceCents: item.unitPriceCents }))
            .sort((left, right) => left.variantId.localeCompare(right.variantId)),
        });
        const prepared = await deps.oneBuyClick.prepareCheckout({
          merchantId: ctx.merchantId,
          conversationId: ctx.sessionId,
          globalUserId: ctx.buyer?.globalUserId,
          cartFingerprint,
        });
        if (!prepared.preparedActionId) return { error: "checkout_preparation_failed" };

        return {
          checkoutPrepared: true,
          actionId: prepared.preparedActionId,
          cartId: cart.sessionId,
          shippingPreference: prepared.shippingPreference,
          paymentPreference: prepared.paymentPreference,
        };
      }

      const sessionId = `chk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const widgetBaseUrl = process.env.WIDGET_BASE_URL ?? "http://localhost:5173";
      const checkoutUrl = `${widgetBaseUrl}/embed/checkout/${sessionId}?cartId=${ctx.sessionId}`;
      return { checkoutUrl, sessionId };
    }
  };
}
