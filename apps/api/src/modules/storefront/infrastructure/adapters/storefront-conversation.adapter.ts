/**
 * Storefront conversation adapter — implements StorefrontConversationPort.
 *
 * Wires StorefrontLangGraphAgent with tool handlers calling real repos.
 */

import { Injectable, Inject } from "@nestjs/common";
import { StorefrontLangGraphAgent } from "../agents/store-langgraph-agent.js";
import type { StorefrontConversationPort, StorefrontConversationInput, StorefrontConversationOutput } from "../../domain/ports/conversation.port.js";
import type { StoreToolHandlers } from "../../domain/tools/store-tools.js";
import { OpenRouterProvider } from "@zyon/conversation-engine";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import type { ProductRepositoryPort, StockRepositoryPort } from "../../../catalog/domain/ports/product-repository.port.js";

export const STOREFRONT_CONVERSATION_ADAPTER = Symbol("StorefrontConversationAdapter");

@Injectable()
export class StorefrontConversationAdapter implements StorefrontConversationPort {
  private readonly agent: StorefrontLangGraphAgent;

  constructor(
    @Inject(MERCHANT_REPOSITORY) private readonly merchantRepo: MerchantRepository,
    @Inject("ProductRepositoryPort") private readonly productRepo: ProductRepositoryPort,
    @Inject("StockRepositoryPort") private readonly stockRepo: StockRepositoryPort
  ) {
    // Initialize agent with provider from env.
    const apiKey = process.env.OPENROUTER_API_KEY || "";
    const provider = new OpenRouterProvider({
      apiKey,
      model: process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4"
    });

    const handlers: StoreToolHandlers = {
      searchProducts: async (args) => {
        const result = await this.productRepo.search({
          merchantId: "", // Will be set by use-case
          query: args.query,
          categoryId: args.categoryId,
          maxPriceCents: args.maxPrice,
          inStockOnly: args.inStockOnly,
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
        const product = await this.productRepo.findById("", args.productId);
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
          args.productIds.slice(0, 5).map((id) => this.productRepo.findById("", id))
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
        // Placeholder: in production, call checkout cart service
        const cartId = args.cartId ?? `cart_${Date.now()}`;
        return {
          cartId,
          items: [{ variantId: args.variantId, quantity: args.quantity }],
          total: 0
        };
      },

      getCart: async (args) => {
        // Placeholder: call checkout cart service
        return {
          cartId: args.cartId,
          items: [],
          total: 0,
          itemCount: 0
        };
      },

      removeCartItem: async (args) => {
        // Placeholder: call checkout cart service
        return {
          cartId: args.cartId,
          items: [],
          total: 0
        };
      },

      quoteShipping: async (args) => {
        // Placeholder: call shipping engine
        return {
          options: [
            { carrier: "Sedex", name: "Sedex", price: 3000, days: 2 },
            { carrier: "PAC", name: "PAC", price: 1500, days: 5 }
          ]
        };
      },

      applyCoupon: async (args) => {
        // Placeholder: call coupons module
        return {
          applied: false,
          reason: "coupon_not_found"
        };
      },

      createCheckoutSession: async (args) => {
        const sessionId = `chk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const widgetBaseUrl = process.env.WIDGET_BASE_URL ?? "http://localhost:5173";
        const checkoutUrl = `${widgetBaseUrl}/embed/checkout/${sessionId}?cartId=${args.cartId}`;
        return { checkoutUrl, sessionId };
      }
    };

    this.agent = new StorefrontLangGraphAgent({
      provider,
      toolHandlers: handlers,
      model: process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4",
      budgetCents: parseInt(process.env.AGENT_BUDGET_CENTS ?? "500", 10)
    });
  }

  async reply(input: StorefrontConversationInput): Promise<StorefrontConversationOutput> {
    const result = await this.agent.run({
      sessionId: input.sessionId,
      merchantId: input.merchantId,
      userMessage: input.userMessage,
      cartId: input.cartId,
      history: input.history,
      merchantName: input.merchantName
    });

    return {
      message: result.message,
      blocks: result.blocks,
      cartId: result.cartId,
      suggestedNext: []
    };
  }
}
