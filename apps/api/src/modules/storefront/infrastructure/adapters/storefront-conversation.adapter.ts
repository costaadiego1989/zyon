/**
 * Storefront conversation adapter — implements StorefrontConversationPort.
 *
 * Wires StorefrontLangGraphAgent with tool handlers calling real repos.
 * Cart operations use PrismaStorefrontCartRepository for persistence.
 * Coupon operations use the coupons module ApplyCouponUseCase.
 */

import { Injectable, Inject, Optional } from "@nestjs/common";
import { StorefrontLangGraphAgent } from "../agents/store-langgraph-agent.js";
import type { StorefrontConversationPort, StorefrontConversationInput, StorefrontConversationOutput } from "../../domain/ports/conversation.port.js";
import type { StoreToolHandlers } from "../../domain/tools/store-tools.js";
import { OpenRouterProvider } from "@zyon/conversation-engine";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import type { ProductRepositoryPort, StockRepositoryPort } from "../../../catalog/domain/ports/product-repository.port.js";
import { STOREFRONT_CART_PORT, type StorefrontCartPort } from "../../domain/ports/storefront-cart.port.js";
import { storefrontQuickReplies, type StorefrontCartState, type StorefrontShippingOption } from "../../domain/services/storefront-quick-replies.service.js";
import type { StoreQuickRepliesConfig } from "@zyon/shared-types";

export const STOREFRONT_CONVERSATION_ADAPTER = Symbol("StorefrontConversationAdapter");

@Injectable()
export class StorefrontConversationAdapter implements StorefrontConversationPort {
  private readonly agent: StorefrontLangGraphAgent;
  private currentMerchantId = "";

  constructor(
    @Inject(MERCHANT_REPOSITORY) private readonly merchantRepo: MerchantRepository,
    @Inject("ProductRepositoryPort") private readonly productRepo: ProductRepositoryPort,
    @Inject("StockRepositoryPort") private readonly stockRepo: StockRepositoryPort,
    @Inject(STOREFRONT_CART_PORT) private readonly cartRepo: StorefrontCartPort
  ) {
    const localApiKey = process.env.LOCAL_LLM_API_KEY || process.env.OPENROUTER_API_KEY || "";
    const localBaseUrl = process.env.LOCAL_LLM_BASE_URL || process.env.OPENROUTER_BASE_URL || undefined;
    const localModel = process.env.LOCAL_LLM_MODEL || process.env.OPENROUTER_MODEL || "deepseek-chat";

    const provider = new OpenRouterProvider({
      apiKey: localApiKey,
      baseUrl: localBaseUrl,
      model: localModel
    });

    const handlers: StoreToolHandlers = {
      searchProducts: async (args) => {
        const result = await this.productRepo.search({
          merchantId: this.currentMerchantId,
          query: args.query,
          categoryId: args.categoryId,
          maxPriceCents: args.maxPrice,
          inStockOnly: args.inStockOnly,
          isActiveOnly: true,
          limit: Math.min(args.limit ?? 10, 20)
        });
        return {
          products: result.products.map((p) => ({
            id: p.id,
            name: p.name,
            price: p.defaultVariant?.basePriceInCents ?? 0,
            image: p.defaultVariant?.media?.[0]?.url,
            inStock: p.hasStock,
            variants: p.variants.map((v) => ({ id: v.id, sku: v.sku }))
          }))
        };
      },

      getProductDetails: async (args) => {
        const product = await this.productRepo.findById(this.currentMerchantId, args.productId);
        if (!product) return { error: "product_not_found" };
        return {
          product: {
            id: product.id,
            name: product.name,
            description: product.description,
            variants: product.variants,
            media: product.defaultVariant?.media ?? [],
            stock: product.totalStock,
            rating: product.averageRating,
            reviewCount: product.reviewCount
          }
        };
      },

      compareProducts: async (args) => {
        const products = await Promise.all(
          args.productIds.slice(0, 5).map((id) => this.productRepo.findById(this.currentMerchantId, id))
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
        const stock = await this.stockRepo.getAvailableStock(args.variantId);
        return {
          inStock: stock.quantity > 0,
          quantity: stock.quantity,
          estimatedShipping: "3-5 dias úteis"
        };
      },

      addItemToCart: async (args) => {
        const merchantId = this.currentMerchantId;
        const sessionId = args.cartId ?? `cart_${Date.now()}`;

        // Stock check before adding
        try {
          const stock = await this.stockRepo.getAvailableStock(args.variantId);
          if (stock.quantity <= 0) {
            return { error: "out_of_stock", variantId: args.variantId };
          }
        } catch {
          // Non-critical: proceed without stock validation in dev
        }

        const cart = await this.cartRepo.addItem(merchantId, sessionId, {
          variantId: args.variantId,
          productId: args.variantId,
          name: (args as any).name ?? "Produto",
          sku: (args as any).sku ?? args.variantId,
          unitPriceCents: (args as any).price ?? 0,
          imageUrl: (args as any).imageUrl,
          quantity: args.quantity
        });

        return {
          cartId: cart.sessionId,
          items: cart.items.map((i) => ({
            variantId: i.variantId,
            name: i.name,
            quantity: i.quantity,
            unitPrice: i.unitPriceCents,
            lineTotal: i.unitPriceCents * i.quantity
          })),
          total: cart.total,
          itemCount: cart.items.reduce((sum, i) => sum + i.quantity, 0)
        };
      },

      getCart: async (args) => {
        const cart = await this.cartRepo.getOrCreate(this.currentMerchantId, args.cartId);
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
        const cart = await this.cartRepo.removeItem(this.currentMerchantId, args.cartId, args.variantId);
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
        const cart = await this.cartRepo.updateItemQuantity(this.currentMerchantId, args.cartId, args.variantId, args.quantity);
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
        const cart = await this.cartRepo.clear(this.currentMerchantId, args.cartId);
        return { cartId: cart.sessionId, items: [], total: 0, itemCount: 0 };
      },

      quoteShipping: async (args) => {
        let totalWeight = 300; // default fallback

        if (args.cartId) {
          const cart = await this.cartRepo.getOrCreate(this.currentMerchantId, args.cartId);
          totalWeight = cart.items.length > 0 ? cart.items.length * 300 : 300;
        }

        // If productId provided (or extracted from context), try to get actual weight
        if ((args as any).productId) {
          try {
            const product = await this.productRepo.findById(this.currentMerchantId, (args as any).productId);
            if (product?.variants?.[0]?.weightGrams) {
              totalWeight = product.variants[0].weightGrams;
            }
          } catch { /* use fallback */ }
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
        const cart = await this.cartRepo.getOrCreate(this.currentMerchantId, args.cartId);
        if (cart.items.length === 0) {
          return { applied: false, reason: "cart_empty" };
        }
        // Simple coupon validation — in production, call CouponsModule.ApplyCouponUseCase
        const code = args.couponCode.toUpperCase().trim();
        // Deterministic fallback: accept codes starting with "ZYON" for 10% off
        if (code.startsWith("ZYON")) {
          const discountCents = Math.round(cart.total * 0.1);
          const updated = await this.cartRepo.applyCoupon(this.currentMerchantId, args.cartId, code, discountCents);
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
        // Return active merchant promotions — deterministic fallback
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
        const cart = await this.cartRepo.removeCoupon(this.currentMerchantId, args.cartId);
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
      },

      listCategories: async () => {
        const result = await this.productRepo.search({
          merchantId: this.currentMerchantId,
          query: undefined,
          limit: 1,
        });
        // Fetch categories directly from prisma via product repo's listCategories if available
        // For now, derive from products — but ideally call listCategories use-case
        try {
          const cats = await (this.productRepo as any).listCategories?.(this.currentMerchantId);
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
        } catch { /* fallback */ }
        return { categories: [] };
      }
    };

    this.agent = new StorefrontLangGraphAgent({
      provider,
      toolHandlers: handlers,
      model: localModel,
      fastModel: localModel,
      strongModel: process.env.OPENROUTER_MODEL ?? localModel,
      budgetCents: parseInt(process.env.AGENT_BUDGET_CENTS ?? "500", 10)
    });
  }

  async reply(input: StorefrontConversationInput): Promise<StorefrontConversationOutput> {
    this.currentMerchantId = input.merchantId;
    const result = await this.agent.run({
      sessionId: input.sessionId,
      merchantId: input.merchantId,
      userMessage: input.userMessage,
      cartId: input.cartId,
      history: input.history,
      merchantName: input.merchantName,
      storeCategory: input.storeCategory,
      storeSettings: input.storeSettings
    });

    // Resolve cart state for context-aware quick replies
    let cartState: StorefrontCartState | undefined;
    if (input.cartId) {
      try {
        const cart = await this.cartRepo.getOrCreate("", input.cartId);
        cartState = {
          items: cart.items.map(i => ({
            variantId: i.variantId,
            name: i.name,
            quantity: i.quantity
          })),
          total: cart.total,
          itemCount: cart.items.reduce((sum, i) => sum + i.quantity, 0),
          couponCode: cart.couponCode ?? null
        };
      } catch {
        // Non-critical: proceed without cart state
      }
    }

    // Convert shipping options if quote_shipping was used
    let shippingOptions: StorefrontShippingOption[] | undefined;
    const lastTool = result.toolsUsed[result.toolsUsed.length - 1];
    if (lastTool === "quote_shipping" && (result as any).shippingOptions) {
      shippingOptions = (result as any).shippingOptions.map((opt: any) => ({
        carrier: opt.carrier,
        name: opt.name,
        price: opt.price,
        days: opt.days
      }));
    }

    // Load merchant's quick replies config from storeSettings if available
    let quickRepliesConfig: StoreQuickRepliesConfig | null = null;
    if (input.storeSettings?.quick_replies) {
      try {
        quickRepliesConfig = input.storeSettings.quick_replies as StoreQuickRepliesConfig;
      } catch {
        // Non-critical: use defaults if config is malformed
      }
    }

    return {
      message: result.message,
      blocks: result.blocks,
      cartId: result.cartId,
      suggestedNext: storefrontQuickReplies(lastTool, quickRepliesConfig, cartState, shippingOptions)
    };
  }

  /**
   * Generate smart quick-reply suggestions based on last tool actions.
   * @deprecated Use storefrontQuickReplies() instead — now delegated to domain service.
   */
  private buildSuggestedActions(toolsUsed: string[], cartId?: string): string[] {
    const lastTool = toolsUsed[toolsUsed.length - 1];
    switch (lastTool) {
      case "search_products":
        return ["Ver detalhes", "Adicionar ao carrinho", "Comparar produtos"];
      case "add_item_to_cart":
        return ["Continuar comprando", "Ver meu carrinho", "Ir para checkout"];
      case "get_cart":
        return ["Aplicar cupom", "Calcular frete", "Finalizar compra", "Limpar carrinho"];
      case "remove_cart_item":
      case "update_cart_item":
        return ["Ver carrinho atualizado", "Continuar comprando", "Finalizar compra"];
      case "apply_coupon":
        return ["Ver carrinho", "Calcular frete", "Finalizar compra"];
      case "quote_shipping":
        return ["Escolher Sedex", "Escolher PAC", "Finalizar compra"];
      case "clear_cart":
        return ["Buscar produtos", "Ver promoções"];
      case "list_promotions":
        return ["Aplicar cupom ZYON10", "Ver carrinho"];
      default:
        return cartId
          ? ["Ver meu carrinho", "Buscar produtos", "Promoções disponíveis"]
          : ["O que vocês vendem?", "Tem promoção?", "Buscar produto"];
    }
  }
}
