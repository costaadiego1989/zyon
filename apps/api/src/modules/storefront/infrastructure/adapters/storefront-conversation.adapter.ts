/**
 * Storefront conversation adapter — implements StorefrontConversationPort.
 *
 * Wires StorefrontLangGraphAgent with tool handlers calling real repos.
 * Cart operations use PrismaStorefrontCartRepository for persistence.
 * Coupon operations use the coupons module ApplyCouponUseCase.
 */

import { Injectable, Inject, Logger, Optional } from "@nestjs/common";
import { StorefrontLangGraphAgent } from "../agents/store-langgraph-agent.js";
import type { StorefrontConversationPort, StorefrontConversationInput, StorefrontConversationOutput } from "../../domain/ports/conversation.port.js";
import type { ConversationBlock } from "../../domain/types/conversation-block.js";
import type { StoreToolHandlers } from "../../domain/tools/store-tools.js";
import { OpenRouterProvider } from "@zyon/conversation-engine";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import { SearchFederatedProductsUseCase } from "../../../marketplace/application/use-cases/search-federated-products.use-case.js";
import type { ProductRepositoryPort, StockRepositoryPort } from "../../../catalog/domain/ports/product-repository.port.js";
import { STOREFRONT_CART_PORT, type StorefrontCartPort } from "../../domain/ports/storefront-cart.port.js";
import { storefrontQuickReplies, type StorefrontCartState, type StorefrontShippingOption } from "../../domain/services/storefront-quick-replies.service.js";
import type { StoreQuickRepliesConfig } from "@zyon/shared-types";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { SupportHandoffService } from "../../../support/application/support-handoff.service.js";

export const STOREFRONT_CONVERSATION_ADAPTER = Symbol("StorefrontConversationAdapter");

@Injectable()
export class StorefrontConversationAdapter implements StorefrontConversationPort {
  private readonly logger = new Logger(StorefrontConversationAdapter.name);
  private readonly agent: StorefrontLangGraphAgent;
  private readonly copyProvider: OpenRouterProvider;
  private currentMerchantId = "";
  private currentSessionId = "";

  constructor(
    @Inject(MERCHANT_REPOSITORY) private readonly merchantRepo: MerchantRepository,
    @Inject("ProductRepositoryPort") private readonly productRepo: ProductRepositoryPort,
    @Inject("StockRepositoryPort") private readonly stockRepo: StockRepositoryPort,
    @Inject(STOREFRONT_CART_PORT) private readonly cartRepo: StorefrontCartPort,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly supportHandoff: SupportHandoffService,
    @Optional() private readonly searchFederatedProducts?: SearchFederatedProductsUseCase,
  ) {
    const localApiKey = process.env.LOCAL_LLM_API_KEY || process.env.OPENROUTER_API_KEY || "";
    const localBaseUrl = process.env.LOCAL_LLM_BASE_URL || process.env.OPENROUTER_BASE_URL || undefined;
    const localModel = process.env.LOCAL_LLM_MODEL || process.env.OPENROUTER_MODEL || "deepseek-chat";

    const provider = new OpenRouterProvider({
      apiKey: localApiKey,
      baseUrl: localBaseUrl,
      model: localModel
    });
    this.copyProvider = provider;

    // Fallback provider: DeepSeek cloud (used when primary LLM fails)
    const fallbackApiKey = process.env.OPENROUTER_API_KEY || process.env.DEEPSEEK_API_KEY || "";
    const fallbackBaseUrl = process.env.OPENROUTER_BASE_URL || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1";
    const fallbackModel = process.env.OPENROUTER_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-chat";
    const fallbackProvider = fallbackApiKey
      ? new OpenRouterProvider({ apiKey: fallbackApiKey, baseUrl: fallbackBaseUrl, model: fallbackModel })
      : undefined;

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

        // Marketplace fallback: when local catalog has few/no relevant results, also search partner stores
        const shouldSearchMarketplace = localProducts.length < 3 && this.searchFederatedProducts && args.query && args.query !== "*";
        if (shouldSearchMarketplace) {
          try {
            const marketplaceResult = await this.searchFederatedProducts.execute({
              query: args.query,
              hostMerchantId: this.currentMerchantId,
              limit: Math.min(args.limit ?? 5, 10),
            });
            const rawProducts = marketplaceResult.products ?? [];
            // Resolve seller names
            const sellerIds = [...new Set(rawProducts.map(p => p.sourceMerchantId))];
            const sellerNames: Record<string, string> = {};
            for (const sid of sellerIds) {
              try {
                const m = await this.merchantRepo.getProfile(sid);
                if (m) sellerNames[sid] = m.name;
              } catch { /* skip */ }
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
          } catch { /* marketplace search failed — return empty */ }
        }

        return {
          products: localProducts,
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
        const variant = await this.prisma.productVariant.findUnique({ where: { id: args.variantId }, select: { product: { select: { type: true } } } });
        const isDigitalOrService = variant?.product?.type === "digital" || variant?.product?.type === "service";
        return {
          inStock: isDigitalOrService || stock.quantity > 0,
          quantity: isDigitalOrService ? 999 : stock.quantity,
          estimatedShipping: isDigitalOrService ? "Entrega imediata" : "3-5 dias úteis"
        };
      },

      addItemToCart: async (args) => {
        const merchantId = this.currentMerchantId;
        // ALWAYS use conversation sessionId as cart key — stable across multiple adds in same session
        const sessionId = this.currentSessionId || `cart_${Date.now()}`;
        this.logger.debug("cart.addItem", { merchantId, sessionId, variantId: args.variantId, qty: args.quantity });

        // Resolve product + real variantId (LLM may pass productId or variantId)
        let productName = "Produto";
        let unitPriceCents = 0;
        let imageUrl: string | undefined;
        let resolvedVariantId = args.variantId;

        try {
          // First try: args.variantId is actually a variant ID (most specific — user explicitly selected)
          let product = await this.productRepo.findById(merchantId, "dummy").catch(() => null);
          let foundVariant = null;

          // Search for the variant across all products
          const searchResult = await this.productRepo.search({ merchantId, limit: 100 });
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

          // Fallback: if not found as variantId, try as productId
          if (!foundVariant) {
            product = await this.productRepo.findById(merchantId, args.variantId);
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

          // Third try: marketplace federated product (cross-store item)
          if (unitPriceCents === 0 && this.searchFederatedProducts) {
            try {
              const fedProduct = await this.prisma.federatedProduct.findUnique({
                where: { id: args.variantId },
              });
              if (fedProduct) {
                productName = fedProduct.name;
                unitPriceCents = fedProduct.priceCents;
                imageUrl = fedProduct.imageUrl ?? undefined;
                resolvedVariantId = fedProduct.id;
              }
            } catch { /* not a federated product ID */ }
          }
        } catch {
          // Non-critical: proceed with what we have
        }

        // Stock check (non-blocking — proceed even if stock unavailable in dev)
        try {
          const stock = await this.stockRepo.getAvailableStock(resolvedVariantId);
          if (stock.quantity <= 0) {
            this.logger.warn("cart.stock.zero_qty", { variantId: resolvedVariantId });
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
        this.logger.debug("cart.afterAdd", { sessionId: cart.sessionId, itemCount: cart.items.length, total: cart.total });

        // Cross-sell: suggest complementary products after add-to-cart
        let crossSellSuggestions: Array<{ name: string; sku: string; price: number; imageUrl?: string; discountPercent?: number }> = [];
        try {
          const crossSellConfig = await this.loadCrossSellConfig(merchantId);
          if (crossSellConfig.enabled && crossSellConfig.touchpoints.pre_cart) {
            const products = await this.productRepo.search({ merchantId, limit: 10, isActiveOnly: true });
            // Exclude the product just added (by name match, most reliable)
            const maxSuggestions = crossSellConfig.limits.maxSuggestionsPerSession ?? 2;
            crossSellSuggestions = products.products
              .filter((p) => p.name !== productName && p.hasStock)
              .slice(0, maxSuggestions)
              .map((p) => ({
                name: p.name,
                sku: p.variants[0]?.sku ?? p.id,
                price: (p.variants[0]?.basePriceInCents ?? 0) / 100,
                imageUrl: p.variants[0]?.media?.[0]?.url,
                discountPercent: crossSellConfig.discount.enabled ? crossSellConfig.discount.percent : undefined,
              }));
          }
        } catch { /* non-critical */ }

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
        const productId = args.productId;
        const limit = args.limit ?? 10;
        try {
          const where: any = { merchantId: this.currentMerchantId, moderationStatus: "approved" };
          if (productId) where.productId = productId;
          const [rows, total] = await Promise.all([
            this.prisma.productReview.findMany({
              where,
              orderBy: { createdAt: "desc" },
              take: limit,
            }),
            this.prisma.productReview.count({ where }),
          ]);
          const reviews = rows.map((r: any) => ({
            id: r.id,
            author: r.buyerName || "Cliente",
            rating: r.rating,
            text: r.text,
            date: r.createdAt?.toISOString?.()?.slice(0, 10) ?? "",
          }));
          const avg = reviews.length > 0
            ? reviews.reduce((s: number, r: any) => s + r.rating, 0) / reviews.length
            : 0;
          return { reviews, totalCount: total, averageRating: Math.round(avg * 10) / 10 };
        } catch {
          return { reviews: [], totalCount: 0, averageRating: 0 };
        }
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
        // Cross-sell "browsing" touchpoint gate: similar-products suggestions are the
        // proactive cross-sell mechanism during store navigation. Respect merchant config —
        // when cross-sell is disabled or the browsing touchpoint is off, return nothing so
        // no cross_sell block is rendered.
        const crossSellConfig = await this.loadCrossSellConfig(this.currentMerchantId);
        if (!crossSellConfig.enabled || !crossSellConfig.touchpoints.browsing) {
          return { products: [] };
        }

        const product = await this.productRepo.findById(this.currentMerchantId, args.productId);
        if (!product) return { products: [] };
        const maxSuggestions = crossSellConfig.limits.maxSuggestionsPerSession ?? 5;
        const requested = Math.min(args.limit ?? 5, maxSuggestions);
        const result = await this.productRepo.search({
          merchantId: this.currentMerchantId,
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
        // Pull merchant FAQ from support hub; fall back to defaults
        const settings = await this.prisma.supportSetting.findUnique({
          where: { merchantId: this.currentMerchantId },
          select: { faqItems: true },
        }).catch(() => null);
        const merchantFaq = Array.isArray(settings?.faqItems) ? settings.faqItems as Array<{ question: string; answer: string }> : [];
        const { DEFAULT_SUPPORT_FAQ } = await import("../../../support/domain/defaults/support-faq.defaults.js");
        const faqs = merchantFaq.length > 0 ? merchantFaq : DEFAULT_SUPPORT_FAQ;
        return { faqs: args.category ? faqs.slice(0, 3) : faqs };
      },

      escalateToHuman: async (args: any) => {
        const result = await this.supportHandoff.createHandoff({
          merchantId: this.currentMerchantId,
          sessionId: this.currentSessionId,
          buyerMessage: args.reason || "Solicitação de atendimento humano",
        });
        return {
          escalated: true,
          ticketId: result.ticketId,
          message: result.reply,
          reason: args.reason,
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
      fallbackProvider,
      toolHandlers: handlers,
      model: localModel,
      fastModel: localModel,
      strongModel: process.env.OPENROUTER_MODEL ?? localModel,
      budgetCents: parseInt(process.env.AGENT_BUDGET_CENTS ?? "500", 10)
    });
  }

  /**
   * When an A/B experiment prompt is active, generate the short intro copy with
   * the variant's tone instead of a hardcoded string. Keeps deterministic blocks
   * fast while still letting the experiment influence the agent's communication.
   * Falls back to the provided default text on any failure or when no experiment.
   */
  private async generateVariantCopy(
    experimentSystemPrompt: string | undefined,
    instruction: string,
    fallback: string,
  ): Promise<string> {
    if (!experimentSystemPrompt) return fallback;
    try {
      const result = await this.copyProvider.chat({
        messages: [
          { role: "system", content: experimentSystemPrompt },
          { role: "user", content: instruction },
        ],
        temperature: 0.7,
        maxTokens: 60,
      });
      const text = result.content?.trim();
      return text && text.length > 0 ? text : fallback;
    } catch {
      return fallback;
    }
  }

  async reply(input: StorefrontConversationInput): Promise<StorefrontConversationOutput> {
    this.currentMerchantId = input.merchantId;
    this.currentSessionId = input.cartId || input.sessionId;

    // Emit checkout_started on every session (idempotent — only first call creates the event)
    this.emitFunnelEvent(input.merchantId, input.sessionId, "checkout_started").catch(() => {});

    // Deterministic shortcut: "Ofertas" / "Ofertas do Dia" bypass LLM and call tool directly
    const normalizedMsg = input.userMessage.trim().toLowerCase();
    if (normalizedMsg === "ofertas" || normalizedMsg === "ofertas do dia" || normalizedMsg === "promoções" || normalizedMsg === "promocoes" || normalizedMsg === "ver produtos") {
      try {
        const result = await this.productRepo.search({
          merchantId: input.merchantId,
          query: normalizedMsg === "ver produtos" ? "*" : undefined,
          isActiveOnly: true,
          limit: 10
        });
        if (result.products.length > 0) {
          // Emit product_viewed for deterministic product listing (non-blocking)
          this.emitFunnelEvent(input.merchantId, input.sessionId, "product_viewed").catch(() => {});

          const formatPrice = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
          const blocks: ConversationBlock[] = [{
            type: "product_carousel",
            data: {
              products: result.products.map((p) => ({
                id: p.id,
                name: p.name,
                price: p.defaultVariant?.basePriceInCents ?? 0,
                priceFormatted: formatPrice(p.defaultVariant?.basePriceInCents ?? 0),
                image: p.defaultVariant?.media?.[0]?.url,
                inStock: p.hasStock,
                badge: "Oferta",
                discountPercent: 15,
              }))
            }
          } as ConversationBlock];
          const isProducts = normalizedMsg === "ver produtos";
          const introDefault = isProducts ? "Encontrei esses produtos para você:" : "Aqui estão nossas ofertas:";
          const introMessage = await this.generateVariantCopy(
            input.experimentSystemPrompt,
            isProducts
              ? "Responda em 1 frase curta e amigável que encontrou produtos pra o cliente. Não liste os produtos."
              : "Responda em 1 frase curta e animada apresentando as ofertas do dia. Não liste os produtos.",
            introDefault,
          );
          return {
            message: introMessage,
            blocks,
            suggestedNext: ["Selecionar Produto", "Filtrar Produtos", "Categorias", "Ofertas do Dia"],
          };
        }
      } catch {
        // Fall through to agent if repo fails
      }
    }

    // Deterministic shortcut: "Detalhes {nome}" — bypass LLM and return product_card directly.
    // Triggered by carousel/card "Saber mais" clicks which pass the product name.
    const detalhesMatch = normalizedMsg.match(/^detalhes\s+(.+)$/);
    if (detalhesMatch) {
      const productName = detalhesMatch[1].trim();
      try {
        const detailResult = await this.productRepo.search({
          merchantId: input.merchantId,
          query: productName,
          isActiveOnly: true,
          limit: 3,
        });
        const product = detailResult.products[0];
        if (product) {
          const formatPrice = (cents: number) =>
            new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
          const price = product.defaultVariant?.basePriceInCents ?? 0;
          const isDigitalOrService = product.type === "digital" || product.type === "service";
          const blocks: ConversationBlock[] = [{
            type: "product_card",
            data: {
              id: product.id,
              name: product.name,
              price,
              priceFormatted: formatPrice(price),
              image: product.defaultVariant?.media?.[0]?.url,
              description: product.description ?? undefined,
              inStock: product.hasStock,
              rating: product.averageRating ?? undefined,
              reviewCount: product.reviewCount ?? 0,
              // "Detalhes {nome}" IS a full-detail request → render the enriched card.
              detailed: true,
              stock: isDigitalOrService ? 999 : (product.totalStock ?? 0),
              sku: product.defaultVariant?.sku ?? product.variants?.[0]?.sku,
              variants: (product.variants ?? []).map((v: any) => {
                const attrs = (v.attributes ?? {}) as Record<string, string>;
                const attrKeys = Object.keys(attrs);
                const attrValues = Object.values(attrs);
                const variantStock = isDigitalOrService ? 999 : Math.max(0, (v.stockQuantity ?? 0) - (v.stockReserved ?? 0));
                return {
                  id: v.id,
                  // Attribute dimension label (e.g. "Cor", "Tamanho"); fall back to variant name/SKU
                  name: v.name || attrKeys.join(" / ") || "Opção",
                  // Attribute values (e.g. "Preto", "42"); fall back to SKU
                  value: attrValues.length > 0 ? attrValues.join(", ") : (v.sku ?? v.name ?? ""),
                  sku: v.sku,
                  stock: variantStock,
                  price: v.basePriceInCents,
                  priceFormatted: v.basePriceInCents ? formatPrice(v.basePriceInCents) : undefined,
                };
              }),
            },
          } as ConversationBlock];
          this.emitFunnelEvent(input.merchantId, input.sessionId, "product_viewed").catch(() => {});
          const detailMessage = await this.generateVariantCopy(
            input.experimentSystemPrompt,
            `Apresente o produto "${product.name}" em 1 frase curta e empolgante. Não repita o nome completo, diga "esse produto" ou algo natural.`,
            `Aqui estão os detalhes de **${product.name}**:`,
          );
          return {
            message: detailMessage,
            blocks,
            suggestedNext: [
              `Adicionar ${product.name} ao carrinho`,
              `Calcular frete para ${product.name}`,
              `Ver avaliações de ${product.name}`,
              "Ver mais produtos",
            ],
          };
        }
      } catch {
        // Fall through to agent
      }
    }

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
      advancedRules: input.advancedRules,
      systemPrompt: input.experimentSystemPrompt,
    });

    // Emit funnel events based on tools used (non-blocking)
    this.emitToolFunnelEvents(input.merchantId, input.sessionId, result.toolsUsed).catch(() => {});

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

    // If LLM returned blocks but empty message, generate contextual intro copy.
    // This ensures the A/B communication strategy is applied even when the LLM
    // focused on tool execution and skipped producing companion text.
    let finalMessage = result.message;
    if ((!finalMessage || finalMessage.trim().length === 0) && result.blocks && result.blocks.length > 0) {
      const blockTypes = result.blocks.map((b: any) => b.type).join(", ");
      const contextHint = this.blockContextHint(result.blocks, result.toolsUsed);
      finalMessage = await this.generateVariantCopy(
        input.experimentSystemPrompt,
        `Você acabou de mostrar ${contextHint} para o cliente. Escreva 1 frase curta e natural acompanhando a apresentação. Não repita dados do componente (preço, nome). Seja empático e conversacional.`,
        this.defaultBlockIntro(result.toolsUsed),
      );
    }

    return {
      message: finalMessage,
      blocks: result.blocks,
      cartId: result.cartId,
      suggestedNext: storefrontQuickReplies(lastTool, quickRepliesConfig, cartState, shippingOptions, input.userMessage)
    };
  }

  /**
   * Contextual hint for the copy generator based on rendered blocks.
   */
  private blockContextHint(blocks: any[], toolsUsed: string[]): string {
    if (toolsUsed.includes("search_products")) return "uma lista de produtos";
    if (toolsUsed.includes("get_product_details")) return "os detalhes de um produto";
    if (toolsUsed.includes("quote_shipping")) return "as opções de frete";
    if (toolsUsed.includes("get_cart")) return "o carrinho do cliente";
    if (toolsUsed.includes("get_reviews")) return "avaliações do produto";
    if (toolsUsed.includes("compare_products")) return "uma comparação entre produtos";
    if (toolsUsed.includes("get_similar_products")) return "produtos similares";
    if (blocks.some((b: any) => b.type === "product_carousel")) return "produtos recomendados";
    if (blocks.some((b: any) => b.type === "product_card")) return "um produto em destaque";
    return "informações relevantes";
  }

  /**
   * Default intro text when no experiment variant is active (zero LLM latency).
   */
  private defaultBlockIntro(toolsUsed: string[]): string {
    if (toolsUsed.includes("search_products")) return "Encontrei algumas opções pra você:";
    if (toolsUsed.includes("get_product_details")) return "Aqui estão os detalhes:";
    if (toolsUsed.includes("quote_shipping")) return "Calculei o frete pra você:";
    if (toolsUsed.includes("get_cart")) return "Seu carrinho:";
    if (toolsUsed.includes("get_reviews")) return "Veja o que outros compradores disseram:";
    if (toolsUsed.includes("compare_products")) return "Comparação entre os produtos:";
    if (toolsUsed.includes("get_similar_products")) return "Produtos similares que podem te interessar:";
    return "Aqui está o que encontrei:";
  }

  /**
   * Ensure a CheckoutSession exists for this storefront conversation.
   * Required because CheckoutEvent has a FK to CheckoutSession.
   */
  private async ensureCheckoutSession(merchantId: string, sessionId: string): Promise<void> {
    const existing = await this.prisma.checkoutSession.findUnique({
      where: { merchantId_sessionId: { merchantId, sessionId } },
      select: { id: true }
    });
    if (!existing) {
      await this.prisma.checkoutSession.create({
        data: {
          merchantId,
          sessionId,
          globalUserId: sessionId,
          conversationId: sessionId,
          cart: {},
          abandonmentScore: 0,
          triggerAgent: false,
          chatHistory: [],
          createdAt: new Date(),
          updatedAt: new Date()
        }
      });
    } else {
      // Touch updatedAt so session appears as "active" in funnel dashboard
      await this.prisma.checkoutSession.update({
        where: { merchantId_sessionId: { merchantId, sessionId } },
        data: { updatedAt: new Date() }
      });
    }
  }

  /**
   * Emit a funnel event for this storefront session.
   * Best-effort: never throws — conversation must not fail due to analytics.
   */
  private async emitFunnelEvent(merchantId: string, sessionId: string, eventName: string): Promise<void> {
    try {
      await this.ensureCheckoutSession(merchantId, sessionId);
      const existing = await this.prisma.checkoutEvent.findFirst({
        where: { merchantId, sessionId, eventName }
      });
      if (!existing) {
        await this.prisma.checkoutEvent.create({
          data: { merchantId, sessionId, eventName, occurredAt: new Date() }
        });
      }
    } catch {
      // Non-blocking: funnel tracking must never break the conversation
    }
  }

  /**
   * Emit funnel events based on tools used during agent execution.
   */
  private async emitToolFunnelEvents(merchantId: string, sessionId: string, toolsUsed: string[]): Promise<void> {
    if (toolsUsed.includes("search_products") || toolsUsed.includes("get_product_details")) {
      await this.emitFunnelEvent(merchantId, sessionId, "product_viewed");
    }
    if (toolsUsed.includes("add_item_to_cart")) {
      await this.emitFunnelEvent(merchantId, sessionId, "cart_viewed");
    }
    if (toolsUsed.includes("quote_shipping")) {
      await this.emitFunnelEvent(merchantId, sessionId, "shipping_option_selected");
    }
    if (toolsUsed.includes("apply_coupon")) {
      await this.emitFunnelEvent(merchantId, sessionId, "coupon_applied");
    }
    if (toolsUsed.includes("create_checkout_session")) {
      await this.emitFunnelEvent(merchantId, sessionId, "payment_method_selected");
    }
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

  private async loadCrossSellConfig(merchantId: string): Promise<{ enabled: boolean; touchpoints: { browsing: boolean; pre_cart: boolean; pre_payment: boolean; post_purchase: boolean }; discount: { enabled: boolean; percent: number }; limits: { maxSuggestionsPerSession: number; cooldownSeconds: number } }> {
    try {
      const merchant = await this.prisma.merchant.findUnique({ where: { id: merchantId }, select: { storeSettings: true } });
      const settings = (merchant?.storeSettings as Record<string, any>) ?? {};
      const cs = settings.crossSell ?? {};
      return {
        enabled: cs.enabled ?? false,
        touchpoints: { browsing: cs.touchpoints?.browsing ?? true, pre_cart: cs.touchpoints?.pre_cart ?? false, pre_payment: cs.touchpoints?.pre_payment ?? true, post_purchase: cs.touchpoints?.post_purchase ?? false },
        discount: { enabled: cs.discount?.enabled ?? false, percent: cs.discount?.percent ?? 10 },
        limits: { maxSuggestionsPerSession: cs.limits?.maxSuggestionsPerSession ?? 2, cooldownSeconds: cs.limits?.cooldownSeconds ?? 120 },
      };
    } catch {
      return { enabled: false, touchpoints: { browsing: true, pre_cart: false, pre_payment: true, post_purchase: false }, discount: { enabled: false, percent: 10 }, limits: { maxSuggestionsPerSession: 2, cooldownSeconds: 120 } };
    }
  }
}
