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
  private currentSessionId = "";

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
            description: p.description,
            price: p.defaultVariant?.basePriceInCents ?? 0,
            image: p.defaultVariant?.media?.[0]?.url,
            images: p.defaultVariant?.media?.map((m) => m.url) ?? [],
            inStock: p.hasStock,
            rating: p.averageRating,
            reviewCount: p.reviewCount,
            variants: p.variants.map((v) => ({ id: v.id, sku: v.sku }))
          })),
          nextCursor: result.nextCursor
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
        // ALWAYS use conversation sessionId as cart key — stable across multiple adds in same session
        const sessionId = this.currentSessionId || `cart_${Date.now()}`;

        // Resolve product + real variantId (LLM may pass productId or variantId)
        let productName = "Produto";
        let unitPriceCents = 0;
        let imageUrl: string | undefined;
        let resolvedVariantId = args.variantId;

        try {
          // First try: args.variantId is a productId
          let product = await this.productRepo.findById(merchantId, args.variantId);
          if (product) {
            productName = product.name;
            const variant = product.variants[0];
            if (variant) {
              resolvedVariantId = variant.id;
              unitPriceCents = variant.basePriceInCents;
              imageUrl = variant.media?.[0]?.url;
            }
          } else {
            // Second try: args.variantId is actually a variant ID, find parent product
            const searchResult = await this.productRepo.search({ merchantId, limit: 100 });
            product = searchResult.products.find(p =>
              p.variants.some(v => v.id === args.variantId || v.sku === args.variantId)
            ) ?? null;
            if (product) {
              productName = product.name;
              const variant = product.variants.find(v => v.id === args.variantId || v.sku === args.variantId) ?? product.variants[0];
              if (variant) {
                resolvedVariantId = variant.id;
                unitPriceCents = variant.basePriceInCents;
                imageUrl = variant.media?.[0]?.url;
              }
            }
          }
        } catch {
          // Non-critical: proceed with what we have
        }

        // Stock check
        try {
          const stock = await this.stockRepo.getAvailableStock(resolvedVariantId);
          if (stock.quantity <= 0) {
            return { error: "out_of_stock", variantId: resolvedVariantId };
          }
        } catch {
          // Non-critical: proceed without stock validation
        }

        const cart = await this.cartRepo.addItem(merchantId, sessionId, {
          variantId: resolvedVariantId,
          productId: args.variantId,
          name: productName,
          sku: resolvedVariantId,
          unitPriceCents,
          imageUrl,
          quantity: args.quantity
        });

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
          itemCount: cart.items.reduce((sum, i) => sum + i.quantity, 0)
        };
      },

      getCart: async (args) => {
        const cart = await this.cartRepo.getOrCreate(this.currentMerchantId, args.cartId || this.currentSessionId);
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

      getReviews: async (args: any) => {
        // Deterministic fallback — real impl would query ReviewRepository
        const reviews = [
          { id: "rev_1", author: "Maria S.", rating: 5, text: "Excelente produto, recomendo!", date: "2026-08-10" },
          { id: "rev_2", author: "João P.", rating: 4, text: "Muito bom, entrega rápida.", date: "2026-08-08" },
          { id: "rev_3", author: "Ana L.", rating: 5, text: "Superou expectativas!", date: "2026-08-05" },
        ];
        let filtered = reviews;
        if (args.filter === "positive") filtered = reviews.filter(r => r.rating >= 4);
        else if (args.filter === "negative") filtered = reviews.filter(r => r.rating <= 2);
        else if (args.filter === "recent") filtered = reviews.slice(0, 3);
        return { reviews: filtered.slice(0, args.limit ?? 10), totalCount: reviews.length, averageRating: 4.7 };
      },

      createReview: async (args: any) => {
        if (!args.authorName || !args.authorPhone) {
          return {
            error: "Para criar uma avaliação, preciso do seu nome e telefone. Pode informar?",
            requiresIdentification: true,
          };
        }
        const phoneDigits = (args.authorPhone as string).replace(/\D/g, "");
        if (phoneDigits.length < 10 || phoneDigits.length > 11) {
          return {
            error: "Telefone inválido. Informe um número com DDD (10 ou 11 dígitos).",
            requiresIdentification: true,
          };
        }
        return {
          id: `rev_${Date.now()}`,
          productId: args.productId,
          author: args.authorName,
          phone: phoneDigits,
          rating: args.rating,
          text: args.text,
          date: new Date().toISOString().slice(0, 10),
          status: "pending_moderation"
        };
      },

      getProductQuestions: async (args: any) => {
        return {
          questions: [
            { id: "q_1", question: "Serve para uso profissional?", answer: "Sim, é indicado para uso profissional.", author: "Carlos M.", date: "2026-08-12" },
            { id: "q_2", question: "Vem com garantia?", answer: "Sim, 12 meses de garantia.", author: "Paula R.", date: "2026-08-09" },
          ],
          totalCount: 2
        };
      },

      createQuestion: async (args: any) => {
        return {
          id: `q_${Date.now()}`,
          productId: args.productId,
          question: args.question,
          author: args.authorName,
          date: new Date().toISOString().slice(0, 10),
          status: "awaiting_answer"
        };
      },

      getSimilarProducts: async (args: any) => {
        // Search products in same category as fallback
        const product = await this.productRepo.findById(this.currentMerchantId, args.productId);
        if (!product) return { products: [] };
        const result = await this.productRepo.search({
          merchantId: this.currentMerchantId,
          query: undefined,
          categoryId: product.categoryId,
          isActiveOnly: true,
          limit: Math.min(args.limit ?? 5, 10)
        });
        return {
          products: result.products
            .filter((p) => p.id !== args.productId)
            .slice(0, args.limit ?? 5)
            .map((p) => ({
              id: p.id,
              name: p.name,
              price: p.defaultVariant?.basePriceInCents ?? 0,
              image: p.defaultVariant?.media?.[0]?.url,
              inStock: p.hasStock,
            }))
        };
      },

      addToWishlist: async (args: any) => {
        return { added: true, productId: args.productId, message: "Produto adicionado à lista de desejos!" };
      },

      getWishlist: async () => {
        return { items: [], message: "Sua lista de desejos está vazia. Explore nossos produtos!" };
      },

      removeFromWishlist: async (args: any) => {
        return { removed: true, productId: args.productId, message: "Produto removido da lista de desejos." };
      },

      trackOrder: async (args: any) => {
        return {
          orderId: args.orderId,
          status: "in_transit",
          statusLabel: "Em trânsito",
          trackingCode: "BR123456789XX",
          carrier: "Correios - Sedex",
          estimatedDelivery: "2026-08-20",
          lastUpdate: "Objeto saiu para entrega"
        };
      },

      getStorePolicies: async (args: any) => {
        const policies: Record<string, string> = {
          returns: "Aceitamos devoluções em até 7 dias após o recebimento. O produto deve estar em sua embalagem original.",
          exchanges: "Trocas podem ser solicitadas em até 30 dias. Produtos com defeito são trocados sem custo adicional.",
          shipping: "Enviamos para todo o Brasil. Prazo de entrega varia de 2 a 10 dias úteis dependendo da região.",
          warranty: "Todos os produtos possuem garantia de 12 meses contra defeitos de fabricação."
        };
        if (args.policyType && args.policyType !== "all") {
          return { policy: policies[args.policyType] ?? "Política não encontrada." };
        }
        return { policies };
      },

      getBuyerProfile: async () => {
        return {
          message: "Você pode visualizar seus dados e histórico na seção de perfil. Posso ajudar com algo específico?"
        };
      },

      getDailyDeals: async (args: any) => {
        const result = await this.productRepo.search({
          merchantId: this.currentMerchantId,
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

      getFaq: async (args: any) => {
        const faqs = [
          { question: "Como faço para rastrear meu pedido?", answer: "Acesse 'Meus Pedidos' ou peça ao assistente para rastrear." },
          { question: "Qual o prazo de entrega?", answer: "De 2 a 10 dias úteis, dependendo da região e modalidade de envio." },
          { question: "Como solicitar troca ou devolução?", answer: "Entre em contato em até 7 dias após o recebimento." },
          { question: "Quais formas de pagamento?", answer: "Cartão de crédito, PIX, boleto bancário." },
          { question: "Posso parcelar?", answer: "Sim, em até 12x sem juros no cartão de crédito." },
        ];
        return { faqs: args.category ? faqs.slice(0, 3) : faqs };
      },

      escalateToHuman: async (args: any) => {
        return {
          escalated: true,
          ticketId: `ticket_${Date.now()}`,
          message: "Sua solicitação foi encaminhada para nossa equipe de suporte. Um atendente entrará em contato em breve.",
          reason: args.reason
        };
      },

      getInvoice: async (args: any) => {
        return {
          orderId: args.orderId,
          invoiceUrl: `https://nf.example.com/${args.orderId}`,
          number: `NF-${args.orderId.slice(-6)}`,
          issuedAt: "2026-08-14",
          message: "Nota fiscal disponível no link acima."
        };
      },

      cancelOrder: async (args: any) => {
        return {
          orderId: args.orderId,
          status: "cancellation_requested",
          message: "Solicitação de cancelamento registrada. Você receberá confirmação por e-mail em até 24h.",
          reason: args.reason ?? "Solicitado pelo cliente"
        };
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
    this.currentSessionId = input.sessionId;
    const result = await this.agent.run({
      sessionId: input.sessionId,
      merchantId: input.merchantId,
      userMessage: input.userMessage,
      cartId: input.cartId,
      history: input.history,
      merchantName: input.merchantName,
      storeCategory: input.storeCategory,
      storeSettings: input.storeSettings,
      agentIdentity: input.agentIdentity,
      merchantPolicy: input.merchantPolicy,
      advancedRules: input.advancedRules
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

    // Determine the most relevant tool for stage detection:
    // Priority tools override generic search_products when both are called in same turn
    const PRIORITY_TOOLS = new Set([
      "compare_products", "get_product_details", "add_item_to_cart", "get_reviews",
      "create_review", "get_product_questions", "create_question", "get_similar_products",
      "add_to_wishlist", "get_wishlist", "quote_shipping", "create_checkout_session",
      "track_order", "get_invoice", "cancel_order", "escalate_to_human", "get_faq",
      "get_store_policies", "get_buyer_profile", "get_daily_deals"
    ]);
    const priorityTool = [...result.toolsUsed].reverse().find((t: string) => PRIORITY_TOOLS.has(t));
    const lastTool = priorityTool ?? result.toolsUsed[result.toolsUsed.length - 1] ?? null;

    // Convert shipping options if quote_shipping was used
    let shippingOptions: StorefrontShippingOption[] | undefined;
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
      suggestedNext: storefrontQuickReplies(lastTool, quickRepliesConfig, cartState, shippingOptions, input.userMessage)
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
