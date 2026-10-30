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
import type { SearchFederatedProductsUseCase } from "../../../marketplace/application/use-cases/search-federated-products.use-case.js";
import type { AddMarketplaceItemToCartStorefrontUseCase } from "../../application/use-cases/add-marketplace-item-to-cart.use-case.js";
import type { PrismaClient } from "@prisma/client";
import type { MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import type { OneBuyClickSessionService } from "../../application/services/one-buy-click-session.service.js";
import { Logger } from "@nestjs/common";
import { StorefrontToolOutcomeUnknownError } from "../../domain/errors/store-tool-outcome-unknown.error.js";
import { resolveSelectedServiceSlot, ServiceSlotError, type SelectedServiceSlot } from "../../../catalog/domain/services/service-schedule.js";
import { buildCrossSellSuggestions, type CrossSellConfig, type CrossSellSuggestion } from "./cart-cross-sell.helper.js";
import { commercialNotice } from "../../domain/services/commercial-notice.js";
import { readExistingMerchantRules } from "../../../merchant/application/services/read-existing-merchant-rules.js";
import { reevaluateCartRules, loadAdvancedRules } from "../../application/services/reevaluate-cart-rules.js";
import { getProductPromoBadge, type ProductPromoMeta } from "../../application/services/storefront-cart-promo.pricing.js";
import type { StorefrontCrossSellCartPort } from "../../domain/ports/storefront-cross-sell-cart.port.js";
import type { StorefrontCouponCartPort } from "../../domain/ports/storefront-coupon-cart.port.js";
import { storefrontCouponCartResultSchema } from "../../domain/contracts/storefront-coupon-cart.schemas.js";
import { selectStorefrontCartLine, storefrontCartLineSelectionLabel, StorefrontCartLineSelectionError } from "../../domain/services/storefront-cart-line-identity.js";
import type { StorefrontCartLineSelector } from "../../domain/ports/storefront-cart.port.js";
import type { StorefrontShippingReferencePort } from "../../domain/ports/storefront-shipping-reference.port.js";
import { storefrontShippingReferenceResultSchema, shippingReferenceUnavailable } from "../../domain/contracts/storefront-shipping-reference.schemas.js";
import { INSUFFICIENT_CART_STOCK_MESSAGE } from "../../domain/services/cart-quantity-input.js";
import { createCartQuantityInspectionReader, inspectSelectedCartQuantity } from "./cart-quantity-inspection.reader.js";

const logger = new Logger("CartHandlers");
function lineSelector(args: StorefrontCartLineSelector): StorefrontCartLineSelector | undefined {
  if (args.optionItemIds === undefined && args.serviceSlotId === undefined) return undefined;
  return { ...(args.optionItemIds === undefined ? {} : { optionItemIds: [...args.optionItemIds] }),
    ...(args.serviceSlotId === undefined ? {} : { serviceSlotId: args.serviceSlotId }) };
}

export { reevaluateCartRules } from "../../application/services/reevaluate-cart-rules.js";

function toCartLineDto(
  i: {
    variantId: string;
    name: string;
    quantity: number;
    unitPriceCents: number;
    imageUrl?: string;
    selectedOptions?: StorefrontCartSelectedOption[];
    selectedServiceSlot?: SelectedServiceSlot;
  },
  meta?: ProductPromoMeta,
) {
  const badge = getProductPromoBadge(meta, i);
  return {
    variantId: i.variantId,
    optionItemIds: (i.selectedOptions ?? []).map(option => option.itemId),
    selectionLabel: storefrontCartLineSelectionLabel(i),
    serviceSlotId: i.selectedServiceSlot?.slotId ?? null,
    name: i.name,
    quantity: i.quantity,
    unitPrice: i.unitPriceCents / 100,
    lineTotal: (i.unitPriceCents * i.quantity) / 100,
    imageUrl: i.imageUrl,
    selectedServiceSlot: i.selectedServiceSlot,
    // Promo badge metadata (present only when an active product promotion applied).
    ...(badge
      ? {
          originalPrice: badge.originalPriceCents / 100,
          discountPercent: badge.discountPercent,
          coupon: badge.coupon,
        }
      : {}),
    selectedOptions: i.selectedOptions?.map((o) => ({
      itemId: o.itemId,
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
  /**
   * Product promotion repository — for resolving active product-level promos
   * before cart-rules evaluation. Optional: when absent, no product promos apply.
   */
  productPromotionRepo?: ProductPromotionRepositoryPort;
  crossSellCart?: Pick<StorefrontCrossSellCartPort, "project">;
  couponCart?: StorefrontCouponCartPort;
  oneBuyClick?: OneBuyClickSessionService;
  shippingReference?: StorefrontShippingReferencePort;
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

export function createCartHandlers(deps: CartHandlerDeps, ctx: ToolRequestContext): Pick<StoreToolHandlers, "inspectCartQuantity" | "addItemToCart" | "getCart" | "removeCartItem" | "updateCartItem" | "clearCart" | "quoteShipping" | "applyCoupon" | "removeCoupon" | "listPromotions" | "createCheckoutSession"> {
  return {
    inspectCartQuantity: createCartQuantityInspectionReader(deps, ctx),
    addItemToCart: async (args) => {
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
      let crossStoreSellerId: string | undefined;
      let crossStoreFederatedProductId: string | undefined;

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
      let selectedServiceSlot: SelectedServiceSlot | undefined;
      try {
        if (resolvedProduct?.type === "service") selectedServiceSlot = resolveSelectedServiceSlot(resolvedProduct.metadata, args.selectedServiceSlotId);
        else if (args.selectedServiceSlotId) return { error: "service_slot_unknown" };
      } catch (error) {
        if (error instanceof ServiceSlotError) return { error: error.code };
        throw error;
      }
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

      // Legacy reduced prices have no original quote or margin authorization.
      // Require a new authoritative quote before any item/benefit write, never silently
      // charge full price or invent a provenance for this benefit.
      if (args.crossSellPromoId) return { error: "cross_sell_quote_review_required",
        detail: "Este benefício precisa de uma nova cotação antes de adicionar o item.",
        commercialNotices: [commercialNotice("benefit_conditions_not_met")] };

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
        commercialNotices: cart.commercialNotices,
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
        commercialNotices: cart.commercialNotices,
        couponCode: cart.couponCode,
        nextNudge,
        activeRules,
        itemCount: cart.items.reduce((sum, i) => sum + i.quantity, 0)
      };
    },

    removeCartItem: async (args) => {
      const selector = lineSelector(args);
      const removed = selector ? await deps.cartRepo.removeItem(ctx.merchantId, ctx.sessionId, args.variantId, selector)
        : await deps.cartRepo.removeItem(ctx.merchantId, ctx.sessionId, args.variantId);
      const { cart, nextNudge, activeRules, promoMeta } = await reevaluateCartRules(deps, ctx.merchantId, ctx.sessionId, removed);
      return {
        cartId: cart.sessionId,
        items: cart.items.map((i) => toCartLineDto(i, promoMeta)),
        total: cart.total / 100,
        discount: cart.discount / 100,
        freeShipping: cart.freeShipping,
        commercialNotices: cart.commercialNotices,
        itemCount: cart.items.reduce((sum, i) => sum + i.quantity, 0),
        nextNudge: nextNudge ?? undefined,
        activeRules: activeRules && activeRules.length > 0 ? activeRules : undefined,
      };
    },

    updateCartItem: async (args) => {
      if (!Number.isSafeInteger(args.quantity) || args.quantity < 0 || args.quantity > 99) return { error: "cart_quantity_invalid" };
      const current = await deps.cartRepo.getOrCreate(ctx.merchantId, ctx.sessionId);
      const selector = lineSelector(args);
      let selected: number | undefined;
      try { selected = selectStorefrontCartLine(current.items, args.variantId, selector); }
      catch (error) { if (error instanceof StorefrontCartLineSelectionError) return { error: error.message }; throw error; }
      if (selected === undefined) return { error: "cart_item_not_found" };
      const admission = await inspectSelectedCartQuantity(deps, ctx.merchantId, current.items, selected, args.quantity);
      if (admission === "product_unavailable") return { error: admission };
      if (admission === "stock_validation_unavailable") return { error: admission, detail: "Não foi possível validar o estoque agora." };
      if (admission === "variant_out_of_stock") return { error: admission, detail: "A variação escolhida não possui estoque suficiente.",
        message: INSUFFICIENT_CART_STOCK_MESSAGE, notApplied: { cartId: current.sessionId, variantId: args.variantId, quantity: args.quantity } };
      const updated = selector ? await deps.cartRepo.updateItemQuantity(ctx.merchantId, ctx.sessionId, args.variantId, args.quantity, selector)
        : await deps.cartRepo.updateItemQuantity(ctx.merchantId, ctx.sessionId, args.variantId, args.quantity);
      const { cart, nextNudge, activeRules, promoMeta } = await reevaluateCartRules(deps, ctx.merchantId, ctx.sessionId, updated);
      return {
        cartId: cart.sessionId,
        items: cart.items.map((i) => toCartLineDto(i, promoMeta)),
        total: cart.total / 100,
        discount: cart.discount / 100,
        freeShipping: cart.freeShipping,
        commercialNotices: cart.commercialNotices,
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
      if (args.cartId !== undefined && args.cartId !== ctx.sessionId) return shippingReferenceUnavailable("cart_review_required");
      if (!deps.shippingReference) return shippingReferenceUnavailable("shipping_reference_unavailable");
      const scope = { merchantId: ctx.merchantId, cartId: ctx.sessionId, conversationId: ctx.conversationId ?? ctx.sessionId,
        ...(ctx.buyer?.globalUserId ? { buyerId: ctx.buyer.globalUserId } : {}) };
      return storefrontShippingReferenceResultSchema.parse(await deps.shippingReference.quote(scope,
        { zipCode: args.zipCode, ...(args.productId ? { productId: args.productId } : {}) }));
    },

    applyCoupon: async (args) => {
      if (!deps.couponCart) return { applied: false, reason: "coupon_service_unavailable" };
      // Snapshot authenticated scope/identity, never model cart refs or region.
      const scope = { merchantId: ctx.merchantId, cartId: ctx.sessionId };
      const input = { code: args.couponCode, ...(ctx.buyer?.globalUserId ? { trustedBuyerGlobalUserId: ctx.buyer.globalUserId } : {}) };
      try {
        return storefrontCouponCartResultSchema.parse(await deps.couponCart.apply(scope, input));
      } catch {
        logger.warn("cart.applyCoupon.outcome_unknown", { merchantId: scope.merchantId, sessionId: scope.cartId });
        throw new StorefrontToolOutcomeUnknownError();
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
            // Personalized experiment codes are disclosed only by the eligible-benefits reader.
            .filter((s) => s.strategy_incentive_execution_id == null)
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
        const merchantRules = await readExistingMerchantRules(deps.merchantRepo, ctx.merchantId).catch(() => null);
        const configuredMax = merchantRules?.maxDiscountPercent;
        const maxDiscount = typeof configuredMax === "number" && Number.isFinite(configuredMax) && configuredMax >= 0 && configuredMax <= 100 ? configuredMax : 0;
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
      const cart = await deps.cartRepo.removeCoupon(ctx.merchantId, ctx.sessionId);
      if (cart.items.some(item => item.crossSellIntent !== undefined)) {
        const result = await reevaluateCartRules(deps, ctx.merchantId, ctx.sessionId, cart);
        return { cartId: result.cart.sessionId, total: result.cart.total, discount: result.cart.discount, couponCode: null };
      }
      return {
        cartId: cart.sessionId,
        total: cart.total,
        discount: 0,
        couponCode: null
      };
    },

    createCheckoutSession: async (args) => {
      const merchant = await deps.merchantRepo.getProfile(ctx.merchantId);
      if (merchant?.budgetModeEnabled) {
        const cart = await deps.cartRepo.getOrCreate(ctx.merchantId, ctx.sessionId);
        if (cart.items.length === 0) return { error: "checkout_cart_empty" };
        return { budgetRequired: true, cartId: cart.sessionId, message: "Solicite o orçamento pelo carrinho. Nenhum pagamento será iniciado." };
      }
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
