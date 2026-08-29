import type { StoreToolHandlers } from "../../domain/tools/types.js";
import type { ToolRequestContext } from "../../domain/tools/tool-context.js";
import type { ProductRepositoryPort, StockRepositoryPort } from "../../../catalog/domain/ports/product-repository.port.js";
import type { MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import type { SearchFederatedProductsUseCase } from "../../../marketplace/application/use-cases/search-federated-products.use-case.js";
import type { PrismaClient } from "@prisma/client";

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
        variants: p.variants.map((v) => ({ id: v.id, sku: v.sku })),
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
      const result = await deps.productRepo.search({
        merchantId: ctx.merchantId,
        query: undefined,
        isActiveOnly: true,
        limit: Math.min(args.limit ?? 5, 10)
      });
      return {
        deals: result.products.slice(0, args.limit ?? 5).map((p) => ({
          id: p.id,
          name: p.name,
          price: p.defaultVariant?.basePriceInCents ?? 0,
          image: p.defaultVariant?.media?.[0]?.url,
          inStock: p.hasStock,
          discountPercent: 15,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        }))
      };
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
