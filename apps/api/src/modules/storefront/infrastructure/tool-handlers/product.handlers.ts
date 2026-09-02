import type { StoreToolHandlers } from "../../domain/tools/types.js";
import type { ToolRequestContext } from "../../domain/tools/tool-context.js";
import type { ProductRepositoryPort, StockRepositoryPort } from "../../../catalog/domain/ports/product-repository.port.js";
import type { MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import type { SearchFederatedProductsUseCase } from "../../../marketplace/application/use-cases/search-federated-products.use-case.js";
import type { PrismaClient } from "@prisma/client";
import { extractOptionGroups } from "../../domain/food-options.js";

export interface ProductHandlerDeps {
  productRepo: ProductRepositoryPort;
  stockRepo: StockRepositoryPort;
  merchantRepo: MerchantRepository;
  prisma: PrismaClient;
  searchFederatedProducts?: SearchFederatedProductsUseCase;
}

export function createProductHandlers(deps: ProductHandlerDeps, ctx: ToolRequestContext): Pick<StoreToolHandlers, "searchProducts" | "getProductDetails" | "compareProducts" | "getProductAvailability" | "getSimilarProducts" | "getDailyDeals" | "listCategories"> {
  return {
    searchProducts: async (args) => {
      const result = await deps.productRepo.search({
        merchantId: ctx.merchantId,
        query: args.query,
        categoryId: args.categoryId,
        maxPriceCents: args.maxPrice,
        inStockOnly: args.inStockOnly,
        isActiveOnly: true,
        limit: Math.min(args.limit ?? 10, 20)
      });

      const localProducts = result.products.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        price: p.defaultVariant?.basePriceInCents ?? 0,
        image: p.defaultVariant?.media?.[0]?.url,
        images: p.defaultVariant?.media?.map((m) => m.url) ?? [],
        inStock: p.hasStock,
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
        })),
        optionGroups: extractOptionGroups(p.metadata),
        source: "local" as const,
      }));

      const federatedSearch = deps.searchFederatedProducts;
      const shouldSearchMarketplace = localProducts.length < 3 && federatedSearch && args.query && args.query !== "*";
      if (shouldSearchMarketplace && federatedSearch) {
        try {
          const marketplaceResult = await federatedSearch.execute({
            query: args.query,
            hostMerchantId: ctx.merchantId,
            limit: Math.min(args.limit ?? 5, 10),
          });
          const rawProducts = marketplaceResult.products ?? [];
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
              products: [...localProducts, ...marketplaceProducts],
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
        nextCursor: result.nextCursor
      };
    },

    getProductDetails: async (args) => {
      const product = await deps.productRepo.findById(ctx.merchantId, args.productId);
      if (!product) return { error: "product_not_found" };
      return {
        product: {
          id: product.id,
          name: product.name,
          description: product.description,
          type: product.type,
          variants: product.variants,
          optionGroups: extractOptionGroups(product.metadata),
          media: product.defaultVariant?.media ?? [],
          stock: product.totalStock,
          inStock: product.hasStock,
          rating: product.averageRating,
          reviewCount: product.reviewCount
        }
      };
    },

    compareProducts: async (args) => {
      const products = await Promise.all(
        args.productIds.slice(0, 5).map((id) => deps.productRepo.findById(ctx.merchantId, id))
      );
      return {
        comparison: products
          .filter((p): p is any => p !== null)
          .map((p) => ({
            id: p.id,
            name: p.name,
            price: p.defaultVariant?.basePriceInCents ?? 0,
            attributes: p.defaultVariant?.attributes ?? {},
            stock: p.totalStock,
            rating: p.averageRating
          }))
      };
    },

    getProductAvailability: async (args) => {
      const stock = await deps.stockRepo.getAvailableStock(args.variantId);
      const variant = await deps.prisma.productVariant.findUnique({ where: { id: args.variantId }, select: { product: { select: { type: true } } } });
      const isDigitalOrService = variant?.product?.type === "digital" || variant?.product?.type === "service";
      return {
        inStock: isDigitalOrService || stock.quantity > 0,
        quantity: isDigitalOrService ? 999 : stock.quantity,
        estimatedShipping: isDigitalOrService ? "Entrega imediata" : "3-5 dias úteis"
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
            image: p.defaultVariant?.media?.[0]?.url,
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
      let promos: Array<{ variantId: string | null; categoryId: string | null; discountType: string; discountValue: number; promoPriceInCents: number | null }> = [];
      try {
        promos = await deps.prisma.productPromotion.findMany({
          where: { merchantId: ctx.merchantId, isActive: true, startsAt: { lte: now }, endsAt: { gt: now } },
          select: { variantId: true, categoryId: true, discountType: true, discountValue: true, promoPriceInCents: true },
        });
      } catch { promos = []; }

      const byVariant = new Map(promos.filter((p) => p.variantId).map((p) => [p.variantId as string, p]));
      const byCategory = new Map(promos.filter((p) => p.categoryId).map((p) => [p.categoryId as string, p]));

      const computeSale = (base: number, promo: { discountType: string; discountValue: number; promoPriceInCents: number | null }): number | null => {
        if (promo.promoPriceInCents != null && promo.promoPriceInCents > 0 && promo.promoPriceInCents < base) return promo.promoPriceInCents;
        if (promo.discountType === "percent" && promo.discountValue > 0) return Math.round(base * (1 - promo.discountValue / 100));
        if (promo.discountType === "fixed" && promo.discountValue > 0) return Math.max(0, base - promo.discountValue);
        return null;
      };

      const deals: Array<{ id: string; name: string; price: number; originalPrice?: number; discountPercent?: number; image?: string; inStock: boolean }> = [];
      for (const p of result.products) {
        const variant = p.defaultVariant;
        const base = variant?.basePriceInCents ?? 0;
        const promo = (variant && byVariant.get(variant.id)) || (p.categoryId && byCategory.get(p.categoryId)) || null;
        if (!promo || base <= 0) continue; // no real promo → not a deal
        const sale = computeSale(base, promo);
        if (sale == null || sale >= base) continue;
        deals.push({
          id: p.id,
          name: p.name,
          price: sale,
          originalPrice: base,
          discountPercent: Math.round((1 - sale / base) * 100),
          image: variant?.media?.[0]?.url,
          inStock: p.hasStock,
        });
        if (deals.length >= limit) break;
      }
      return { deals };
    },

    listCategories: async () => {
      const result = await deps.productRepo.search({
        merchantId: ctx.merchantId,
        query: undefined,
        limit: 1,
      });
      try {
        const cats = await (deps.productRepo as any).listCategories?.(ctx.merchantId);
        if (cats?.length) {
          return {
            categories: cats.map((c: any) => ({
              id: c.id,
              name: c.name,
              slug: c.slug,
              productCount: c._count?.products ?? 0,
            }))
          };
        }
      } catch { }
      return { categories: [] };
    }
  };
}
