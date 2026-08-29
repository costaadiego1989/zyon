import type { StoreToolHandlers } from "../../domain/tools/types.js";
import type { ToolRequestContext } from "../../domain/tools/tool-context.js";
import type { ProductRepositoryPort, StockRepositoryPort } from "../../../catalog/domain/ports/product-repository.port.js";
import type { StorefrontCartPort } from "../../domain/ports/storefront-cart.port.js";
import type { ListEligibleCrossSellsUseCase } from "../../../cross-sell/application/use-cases/list-eligible-cross-sells.use-case.js";
import type { SearchFederatedProductsUseCase } from "../../../marketplace/application/use-cases/search-federated-products.use-case.js";
import type { PrismaClient } from "@prisma/client";
import { Logger } from "@nestjs/common";
import { buildCrossSellSuggestions, type CrossSellConfig, type CrossSellSuggestion } from "./cart-cross-sell.helper.js";

const logger = new Logger("CartHandlers");

export interface CartHandlerDeps {
  productRepo: ProductRepositoryPort;
  stockRepo: StockRepositoryPort;
  cartRepo: StorefrontCartPort;
  prisma: PrismaClient;
  searchFederatedProducts?: SearchFederatedProductsUseCase;
  listEligibleCrossSells?: ListEligibleCrossSellsUseCase;
  loadCrossSellConfig: (merchantId: string) => Promise<CrossSellConfig>;
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
            productName = product.name;
            resolvedVariantId = foundVariant.id;
            unitPriceCents = foundVariant.basePriceInCents;
            imageUrl = foundVariant.media?.[0]?.url;
          }
        }

        if (!foundVariant) {
          product = await deps.productRepo.findById(ctx.merchantId, args.variantId);
          if (product) {
            productName = product.name;
            const variant = product.variants[0];
            if (variant) {
              resolvedVariantId = variant.id;
              unitPriceCents = variant.basePriceInCents;
              imageUrl = variant.media?.[0]?.url;
            }
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

      const cart = await deps.cartRepo.addItem(ctx.merchantId, sessionId, {
        variantId: resolvedVariantId,
        productId: args.variantId,
        name: productName,
        sku: resolvedVariantId,
        unitPriceCents,
        imageUrl,
        quantity: args.quantity
      });
      logger.debug("cart.afterAdd", { sessionId: cart.sessionId, itemCount: cart.items.length, total: cart.total });

      let crossSellSuggestions: CrossSellSuggestion[] = [];
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
        }
      } catch { }

      return {
        cartId: cart.sessionId,
        items: cart.items.map((i) => ({
          variantId: i.variantId,
          name: i.name,
          quantity: i.quantity,
          unitPrice: i.unitPriceCents / 100,
          lineTotal: (i.unitPriceCents * i.quantity) / 100
        })),
        total: cart.total / 100,
        itemCount: cart.items.reduce((sum, i) => sum + i.quantity, 0),
        crossSellSuggestions: crossSellSuggestions.length > 0 ? crossSellSuggestions : undefined,
      };
    },

    getCart: async (args) => {
      const cart = await deps.cartRepo.getOrCreate(ctx.merchantId, args.cartId || ctx.sessionId);
      return {
        cartId: cart.sessionId,
        items: cart.items.map((i) => ({
          variantId: i.variantId,
          name: i.name,
          quantity: i.quantity,
          unitPrice: i.unitPriceCents,
          lineTotal: i.unitPriceCents * i.quantity,
          imageUrl: i.imageUrl
        })),
        total: cart.total,
        discount: cart.discount,
        couponCode: cart.couponCode,
        itemCount: cart.items.reduce((sum, i) => sum + i.quantity, 0)
      };
    },

    removeCartItem: async (args) => {
      const cart = await deps.cartRepo.removeItem(ctx.merchantId, args.cartId, args.variantId);
      return {
        cartId: cart.sessionId,
        items: cart.items.map((i) => ({
          variantId: i.variantId,
          name: i.name,
          quantity: i.quantity,
          unitPrice: i.unitPriceCents
        })),
        total: cart.total,
        itemCount: cart.items.reduce((sum, i) => sum + i.quantity, 0)
      };
    },

    updateCartItem: async (args) => {
      const cart = await deps.cartRepo.updateItemQuantity(ctx.merchantId, args.cartId, args.variantId, args.quantity);
      return {
        cartId: cart.sessionId,
        items: cart.items.map((i) => ({
          variantId: i.variantId,
          name: i.name,
          quantity: i.quantity,
          unitPrice: i.unitPriceCents
        })),
        total: cart.total,
        itemCount: cart.items.reduce((sum, i) => sum + i.quantity, 0)
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
      const cart = await deps.cartRepo.getOrCreate(ctx.merchantId, args.cartId);
      if (cart.items.length === 0) {
        return { applied: false, reason: "cart_empty" };
      }
      const code = args.couponCode.toUpperCase().trim();
      if (code.startsWith("ZYON")) {
        const discountCents = Math.round(cart.total * 0.1);
        const updated = await deps.cartRepo.applyCoupon(ctx.merchantId, args.cartId, code, discountCents);
        return {
          applied: true,
          couponCode: code,
          discountCents,
          newTotal: updated.total - discountCents,
          reason: "success"
        };
      }
      return { applied: false, reason: "coupon_not_found" };
    },

    listPromotions: async (_args) => {
      return {
        promotions: [
          {
            code: "ZYON10",
            type: "percent",
            value: 10,
            description: "10% de desconto em todo o site",
            minCartValue: 5000,
            expiresAt: null
          }
        ]
      };
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
      const sessionId = `chk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const widgetBaseUrl = process.env.WIDGET_BASE_URL ?? "http://localhost:5173";
      const checkoutUrl = `${widgetBaseUrl}/embed/checkout/${sessionId}?cartId=${args.cartId}`;
      return { checkoutUrl, sessionId };
    }
  };
}
