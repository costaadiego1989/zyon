import type { StoreToolHandlers } from "../../domain/tools/types.js";
import type { ToolRequestContext } from "../../domain/tools/tool-context.js";
import type { ProductRepositoryPort, StockRepositoryPort } from "../../../catalog/domain/ports/product-repository.port.js";
import type { MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import { readExistingMerchantRules } from "../../../merchant/application/services/read-existing-merchant-rules.js";
import type { SearchFederatedProductsUseCase } from "../../../marketplace/application/use-cases/search-federated-products.use-case.js";
import type { PrismaClient } from "@prisma/client";
import type { ProductPromotionEntity } from "../../../catalog/domain/ports/product-promotion-repository.port.js";
import type { StorefrontCart } from "../../domain/ports/storefront-cart.port.js";
import { applyProductPromoPricing } from "../../application/services/storefront-cart-promo.pricing.js";
import { loadCartCosts } from "../../application/services/reevaluate-cart-rules.js";
import { extractOptionGroups } from "../../domain/food-options.js";
import { isDigitalContentReady } from "../../../catalog/domain/services/product-type-validation.js";
import { isServiceOfferAvailable } from "../../../catalog/domain/services/service-schedule.js";
import { loadProductNoticeRules, productRuleNotices } from "../product-rule-notices.js";
import { productGallery } from "../product-gallery.js";
import { ServiceSlotHoldsService } from "../../../../shared/bookings/service-slot-holds.service.js";
import { contextualProductQuery, contextualSearchGroups } from "../../../catalog/domain/services/contextual-product-search.js";

import { buildCrossSellSuggestions, type CartSnapshot, type CrossSellConfig, type CrossSellSuggestion } from "./cart-cross-sell.helper.js";
import type { StorefrontCartPort } from "../../domain/ports/storefront-cart.port.js";
import type { ListEligibleCrossSellsUseCase } from "../../../cross-sell/application/use-cases/list-eligible-cross-sells.use-case.js";

export interface ProductHandlerDeps {
  cartRepo?: StorefrontCartPort;
  loadCrossSellConfig?: (merchantId: string) => Promise<CrossSellConfig>;
  listEligibleCrossSells?: ListEligibleCrossSellsUseCase;
  productRepo: ProductRepositoryPort;
  stockRepo: StockRepositoryPort;
  merchantRepo: MerchantRepository;
  prisma: PrismaClient;
  searchFederatedProducts?: SearchFederatedProductsUseCase;
}

export function createProductHandlers(deps: ProductHandlerDeps, ctx: ToolRequestContext): Pick<StoreToolHandlers, "searchProducts" | "getProductDetails" | "compareProducts" | "getProductAvailability" | "getSimilarProducts" | "getDailyDeals" | "listCategories"> {
  return {
    searchProducts: async (args) => {
      const query = contextualProductQuery(args.query, ctx.userMessage);
      const contextual = !!query && contextualSearchGroups(query).length > 0;
      const result = await deps.productRepo.search({
        merchantId: ctx.merchantId,
        query,
        queryMode: contextual ? "contextual" : undefined,
        categoryId: args.categoryId,
        maxPriceCents: args.maxPrice,
        inStockOnly: args.inStockOnly,
        isActiveOnly: true,
        cursor: args.cursor,
        limit: Math.min(args.limit ?? 10, 20)
      });

      const noticeRules = await loadProductNoticeRules(deps.prisma, ctx.merchantId, deps.merchantRepo);
      const localProducts = await Promise.all(result.products.map(async (p) => {
        const serviceSchedule = p.type === "service" && p.defaultVariant ? await new ServiceSlotHoldsService(deps.prisma).availability(ctx.merchantId, p.defaultVariant.id, p.metadata) : undefined;
        const ruleNotices = productRuleNotices(noticeRules, p.variants.map((v) => v.sku), p.id);
        return {
          id: p.id,
          type: p.type,
          serviceSchedule,
          name: p.name,
          description: p.description,
          price: p.defaultVariant?.basePriceInCents ?? 0,
          ...productGallery(p),
          inStock: p.hasStock && (!serviceSchedule || serviceSchedule.slots.some(slot => slot.selectable)),
          rating: p.averageRating,
          reviewCount: p.reviewCount,
          // Full variant shape so the storefront can render a variant selector
          // (attributes/price/stock), not just raw SKUs.
          variants: p.variants.map((v) => ({
            id: v.id,
            sku: v.sku,
            attributes: v.attributes ?? {},
            basePriceInCents: v.basePriceInCents,
            stockQuantity: v.stockQuantity,
            stockReserved: v.stockReserved,
          })),
          optionGroups: extractOptionGroups(p.metadata),
          ...(ruleNotices.length > 0 ? { ruleNotices } : {}),
          source: "local" as const,
        };
      }));

      const federatedSearch = deps.searchFederatedProducts;
      const shouldSearchMarketplace = localProducts.length === 0 && federatedSearch && query && query !== "*";
      if (shouldSearchMarketplace && federatedSearch) {
        try {
          const marketplaceResult = await federatedSearch.execute({
            query: query!,
            hostMerchantId: ctx.merchantId,
            limit: Math.min(args.limit ?? 5, 10),
            maxPriceCents: args.maxPrice,
          });
          const rawProducts = (marketplaceResult.products ?? []).filter(p => p.stockAvailable && p.currency === "BRL"
            && (args.maxPrice === undefined || p.priceCents <= args.maxPrice));
          const sellerIds = [...new Set(rawProducts.map(p => p.sourceMerchantId))];
          const sellerNames: Record<string, string> = {};
          for (const sid of sellerIds) {
            try {
              const m = await deps.merchantRepo.getProfile(sid);
              if (m) sellerNames[sid] = m.name;
            } catch { }
          }
          const marketplaceProducts = rawProducts.map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description || "",
            price: p.priceCents,
            image: p.imageUrl,
            images: p.imageUrl ? [p.imageUrl] : [],
            inStock: p.stockAvailable,
            rating: null,
            reviewCount: 0,
            variants: [{ id: p.id, sku: p.sourceProductId }],
            source: "marketplace" as const,
            sellerMerchantId: p.sourceMerchantId,
            sellerName: sellerNames[p.sourceMerchantId] || "Loja parceira",
          }));
          if (marketplaceProducts.length > 0) {
            return {
              products: [...localProducts, ...marketplaceProducts].slice(0, Math.min(args.limit ?? 10, 20)),
              source: localProducts.length > 0 ? "mixed" : "marketplace",
              note: localProducts.length > 0
                ? "Encontrei produtos locais e de lojas parceiras"
                : "Produtos de lojas parceiras do marketplace",
              nextCursor: null,
            };
          }
        } catch { }
      }

      return {
        products: localProducts,
        nextCursor: result.nextCursor, query, categoryId: args.categoryId,
        ...(contextual && !localProducts.length ? { note: "Não encontrei produtos correspondentes. Pode detalhar o que procura?" } : {}),
      };
    },

    getProductDetails: async (args) => {
      const product = await deps.productRepo.findById(ctx.merchantId, args.productId);
      if (!product) {
        const federated = await deps.searchFederatedProducts?.getAuthorizedById(ctx.merchantId, args.productId);
        if (!federated) return { error: "product_not_found" };
        const seller = await deps.merchantRepo.getProfile(federated.sourceMerchantId);
        return { product: { id: federated.id, name: federated.name, description: federated.description, price: federated.priceCents,
          image: federated.imageUrl, images: federated.imageUrl ? [federated.imageUrl] : [], inStock: federated.stockAvailable,
          source: "marketplace", sellerName: seller?.name ?? "Loja parceira", sellerMerchantId: federated.sourceMerchantId,
          variants: [{ id: federated.id, sku: federated.sourceProductId, basePriceInCents: federated.priceCents,
            stockQuantity: federated.stockAvailable ? undefined : 0, isActive: true }],
        } };
      }
      const serviceSchedule = product.type === "service" && product.defaultVariant ? await new ServiceSlotHoldsService(deps.prisma).availability(ctx.merchantId, product.defaultVariant.id, product.metadata) : undefined;
      const noticeRules = await loadProductNoticeRules(deps.prisma, ctx.merchantId, deps.merchantRepo);
      const ruleNotices = productRuleNotices(
        noticeRules,
        product.variants.filter((variant) => variant.isActive).map((variant) => variant.sku),
        product.id,
      );
      const config = await deps.loadCrossSellConfig?.(ctx.merchantId);
      let crossSellSuggestions: CrossSellSuggestion[] = [];
      if (config?.enabled && config.touchpoints.pre_cart && deps.cartRepo) {
        const cart = await deps.cartRepo.getOrCreate(ctx.merchantId, ctx.sessionId);
        const viewedVariant = product.variants.find((variant) => variant.isActive);
        // Before the shopper adds an item, evaluate the offer as if the viewed
        // product were in the cart. This is only an eligibility snapshot: it
        // never persists an item or changes the shopper's actual cart.
        const crossSellCart: CartSnapshot = viewedVariant && !cart.items.some((item) => item.variantId === viewedVariant.id)
          ? {
              sessionId: cart.sessionId,
              total: cart.total + viewedVariant.basePriceInCents,
              items: [
                ...cart.items,
                {
                  variantId: viewedVariant.id,
                  sku: viewedVariant.sku,
                  name: product.name,
                  unitPriceCents: viewedVariant.basePriceInCents,
                  quantity: 1,
                },
              ],
            }
          : cart;
        crossSellSuggestions = await buildCrossSellSuggestions(deps, ctx.merchantId, crossSellCart, config, product.name);
      }
      return {
        crossSellSuggestions,
        crossSellDisplayMode: crossSellSuggestions.length > 0 ? config?.display?.mode : undefined,
        product: {
          id: product.id,
          name: product.name,
          description: product.description,
          type: product.type,
          serviceSchedule,
          ...(ruleNotices.length > 0 ? { ruleNotices } : {}),
          variants: product.variants,
          optionGroups: extractOptionGroups(product.metadata),
          media: product.defaultVariant?.media ?? [],
          ...productGallery(product),
          stock: product.type === "digital" || product.type === "service" ? null : product.totalStock,
          inStock: product.hasStock && (!serviceSchedule || serviceSchedule.slots.some(slot => slot.selectable)),
          rating: product.averageRating,
          reviewCount: product.reviewCount
        }
      };
    },

    compareProducts: async (args) => {
      const productIds = uniqueStrings([...(Array.isArray(args.productIds) ? args.productIds : []), args.productId]).slice(0, 5);
      const productNames = uniqueStrings([...(Array.isArray(args.productNames) ? args.productNames : []), args.productName]).slice(0, 5);
      if (productIds.length === 0 && productNames.length === 0) {
        return { error: "comparison_product_required", comparison: [], message: "Informe o produto atual ou os nomes dos produtos que deseja comparar." };
      }

      const products = (await Promise.all(
        productIds.map((id) => deps.productRepo.findById(ctx.merchantId, id)),
      )).filter((product): product is NonNullable<typeof product> => Boolean(product?.isActive));

      const missingProductNames: string[] = [];
      for (const productName of productNames) {
        const result = await deps.productRepo.search({ merchantId: ctx.merchantId, query: productName, isActiveOnly: true, limit: 10 });
        const exactMatch = result.products.find((product) => normalizeProductName(product.name) === normalizeProductName(productName));
        if (exactMatch && !products.some((product) => product.id === exactMatch.id)) products.push(exactMatch);
        else if (!exactMatch) missingProductNames.push(productName);
      }

      const requestedCount = productIds.length + productNames.length;
      const baseProduct = products[0];
      if (args.includeSimilar !== false && requestedCount === 1 && products.length === 1 && baseProduct?.categoryId) {
        const similar = await deps.productRepo.search({ merchantId: ctx.merchantId, categoryId: baseProduct.categoryId, isActiveOnly: true, limit: 5 });
        for (const product of similar.products) {
          if (products.length >= 5) break;
          if (product.id !== baseProduct.id && !products.some((item) => item.id === product.id)) products.push(product);
        }
      }

      return {
        comparison: products.map((product) => ({
          id: product.id,
          name: product.name,
          price: product.defaultVariant?.basePriceInCents ?? 0,
          attributes: product.defaultVariant?.attributes ?? {},
          stock: product.totalStock,
          rating: product.averageRating,
          type: product.type,
        })),
        requestedProductNames: productNames,
        missingProductNames,
        requiresProductNames: products.length < 2,
      };
    },

    getProductAvailability: async (args) => {
      const variant = await deps.prisma.productVariant.findFirst({ where: {
        id: args.variantId, isActive: true, product: { merchantId: ctx.merchantId, isActive: true, deletedAt: null },
      }, select: { product: { select: { type: true, metadata: true } } } });
      if (!variant) return { error: "product_not_found", inStock: false, quantity: 0 };
      if (variant.product.type === "digital") return {
        inStock: isDigitalContentReady(variant.product.metadata), quantity: null,
        estimatedShipping: "Acesso liberado após confirmação do pagamento",
      };
      if (variant.product.type === "service") return {
        inStock: isServiceOfferAvailable(variant.product.metadata), quantity: null, estimatedShipping: "Conforme as condições do serviço",
      };
      const stock = await deps.stockRepo.getAvailableStock(args.variantId);
      const available = Math.max(0, stock.quantity - stock.reserved);
      return {
        inStock: available > 0, quantity: available, estimatedShipping: "3-5 dias úteis",
      };
    },

    getSimilarProducts: async (args: any) => {
      const product = await deps.productRepo.findById(ctx.merchantId, args.productId);
      if (!product) return { products: [] };

      const requested = Math.min(args.limit ?? 5, 10);
      const result = await deps.productRepo.search({
        merchantId: ctx.merchantId,
        query: undefined,
        categoryId: product.categoryId,
        isActiveOnly: true,
        limit: Math.min(requested + 1, 10)
      });
      const formatPrice = (cents: number) =>
        new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
      return {
        products: result.products
          .filter((p) => p.id !== args.productId)
          .slice(0, requested)
          .map((p) => ({
            id: p.id,
            name: p.name,
            price: p.defaultVariant?.basePriceInCents ?? 0,
            priceFormatted: formatPrice(p.defaultVariant?.basePriceInCents ?? 0),
            ...productGallery(p),
            inStock: p.hasStock,
            rating: p.averageRating ?? undefined,
            reviewCount: p.reviewCount ?? 0,
          }))
      };
    },

    getDailyDeals: async (args: any) => {
      const limit = Math.min(args.limit ?? 10, 30);
      const result = await deps.productRepo.search({
        merchantId: ctx.merchantId,
        query: undefined,
        isActiveOnly: true,
        limit: 60, // fetch a wider window; we filter to those with a real active promo
      });

      // Real promotions only: cross active products with product_promotions rows
      // that are active and within their window. NEVER invent a discount — a product
      // with no matching promo simply does not appear in deals.
      const now = new Date();
      let promos: ProductPromotionEntity[] = [];
      try {
        promos = await deps.prisma.productPromotion.findMany({
          where: { merchantId: ctx.merchantId, isActive: true, startsAt: { lte: now }, endsAt: { gt: now } },
          select: { id: true, merchantId: true, productId: true, variantId: true, categoryId: true, couponId: true,
            discountType: true, discountValue: true, promoPriceInCents: true, isActive: true, startsAt: true, endsAt: true,
            createdAt: true, updatedAt: true },
        });
      } catch { promos = []; }
      const deals: Array<{ id: string; name: string; price: number; originalPrice?: number; discountPercent?: number; image?: string; images: string[]; inStock: boolean; coupon?: boolean }> = [];
      if (!promos.length) return { deals };
      const merchantRules = await readExistingMerchantRules(deps.merchantRepo, ctx.merchantId).catch(() => undefined);
      if (!merchantRules) return { deals };

      for (const p of result.products) {
        const variant = p.defaultVariant;
        const base = variant?.basePriceInCents ?? 0;
        if (!variant || base <= 0) continue;
        // An ephemeral one-item SERVER quote, not a cart mutation. Reuse the
        // cart's selector, original-price proof, combined ceiling and margin.
        // Unknown/stale authority suppresses the offer, never restores raw sale.
        const quote: StorefrontCart = { id: `daily-deal:${p.id}`, merchantId: ctx.merchantId, sessionId: ctx.sessionId,
          items: [{ variantId: variant.id, productId: p.id, categoryId: p.categoryId, sku: variant.sku, name: p.name,
            quantity: 1, unitPriceCents: base }], total: base, discount: 0, couponCode: null, freeShipping: false,
          createdAt: now, updatedAt: now };
        try {
          const costs = await loadCartCosts(deps.prisma, ctx.merchantId, quote, true);
          const meta = await applyProductPromoPricing({ findActiveBySku: async () => promos }, ctx.merchantId, quote,
            { rules: merchantRules, costsByVariant: costs });
          const badge = meta.get(variant.id);
          if (!badge) continue;
          // Coupon-linked promotions remain badges only, never an inline grant.
          deals.push({
            id: p.id, name: p.name, price: quote.items[0]!.unitPriceCents,
            ...productGallery(p), inStock: p.hasStock,
            ...(badge.coupon ? { coupon: true } : { originalPrice: badge.originalPriceCents, discountPercent: badge.discountPercent }),
          });
          if (deals.length >= limit) break;
        } catch { /* No authorized price => no deal to advertise. */ }
      }
      return { deals };
    },

    listCategories: async () => {
      try {
        const cats = await (deps.productRepo as any).listCategories?.(ctx.merchantId, { publicOnly: true });
        if (cats?.length) {
          return {
            categories: cats.map((c: any) => ({
              id: c.id,
              name: c.name,
              slug: c.slug,
              productCount: Number.isInteger(c.productCount) && c.productCount >= 0 ? c.productCount : c._count?.products ?? 0,
            }))
          };
        }
      } catch { }
      return { categories: [] };
    }
  };
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean))];
}

function normalizeProductName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ")
    .trim();
}
