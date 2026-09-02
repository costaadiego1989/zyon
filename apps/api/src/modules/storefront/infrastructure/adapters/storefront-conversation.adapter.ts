import { Injectable, Inject, Logger, Optional } from "@nestjs/common";
import { StorefrontLangGraphAgent } from "../agents/store-langgraph-agent.js";
import type { StorefrontConversationPort, StorefrontConversationInput, StorefrontConversationOutput, NudgeCopyInput } from "../../domain/ports/conversation.port.js";
import type { ConversationBlock } from "../../domain/types/conversation-block.js";
import type { StoreToolHandlers } from "../../domain/tools/store-tools.js";
import type { ToolRequestContext } from "../../domain/tools/tool-context.js";
import { composeStoreToolHandlers, type AllHandlerDeps } from "../tool-handlers/index.js";
import { OpenRouterProvider } from "@zyon/conversation-engine";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import { SearchFederatedProductsUseCase } from "../../../marketplace/application/use-cases/search-federated-products.use-case.js";
import { ListEligibleCrossSellsUseCase } from "../../../cross-sell/application/use-cases/list-eligible-cross-sells.use-case.js";
import { CROSS_SELL_PROMOTION_REPOSITORY, type CrossSellPromotionRepository } from "../../../cross-sell/domain/ports/cross-sell-promotion-repository.port.js";
import { ApplyCouponUseCase } from "../../../coupons/application/use-cases/apply-coupon.use-case.js";
import { COUPON_REPOSITORY, type CouponRepository } from "../../../coupons/domain/ports/coupon-repository.port.js";
import type { ProductRepositoryPort, StockRepositoryPort } from "../../../catalog/domain/ports/product-repository.port.js";
import { STOREFRONT_CART_PORT, type StorefrontCartPort } from "../../domain/ports/storefront-cart.port.js";
import { storefrontQuickReplies, type StorefrontCartState, type StorefrontShippingOption } from "../../domain/services/storefront-quick-replies.service.js";
import type { StoreQuickRepliesConfig } from "@zyon/shared-types";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { SupportHandoffService } from "../../../support/application/support-handoff.service.js";
import { AgentCopyService } from "../copy/agent-copy.service.js";
import { resolveDeterministicShortcut } from "../shortcuts/deterministic-shortcuts.service.js";

export const STOREFRONT_CONVERSATION_ADAPTER = Symbol("StorefrontConversationAdapter");

@Injectable()
export class StorefrontConversationAdapter implements StorefrontConversationPort {
  private readonly logger = new Logger(StorefrontConversationAdapter.name);
  private readonly agent: StorefrontLangGraphAgent;
  private readonly copyProvider: OpenRouterProvider;
  private readonly copyService: AgentCopyService;
  private readonly handlerDeps: AllHandlerDeps;

  constructor(
    @Inject(MERCHANT_REPOSITORY) private readonly merchantRepo: MerchantRepository,
    @Inject("ProductRepositoryPort") private readonly productRepo: ProductRepositoryPort,
    @Inject("StockRepositoryPort") private readonly stockRepo: StockRepositoryPort,
    @Inject(STOREFRONT_CART_PORT) private readonly cartRepo: StorefrontCartPort,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly supportHandoff: SupportHandoffService,
    @Optional() private readonly searchFederatedProducts?: SearchFederatedProductsUseCase,
    @Optional() private readonly listEligibleCrossSells?: ListEligibleCrossSellsUseCase,
    @Optional() @Inject(CROSS_SELL_PROMOTION_REPOSITORY) private readonly crossSellPromotionRepo?: CrossSellPromotionRepository,
    @Optional() private readonly applyCouponUseCase?: ApplyCouponUseCase,
    @Optional() @Inject(COUPON_REPOSITORY) private readonly couponRepo?: CouponRepository,
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
    this.copyService = new AgentCopyService(provider);

    const fallbackApiKey = process.env.OPENROUTER_API_KEY || process.env.DEEPSEEK_API_KEY || "";
    const fallbackBaseUrl = process.env.OPENROUTER_BASE_URL || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1";
    const fallbackModel = process.env.OPENROUTER_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-chat";
    const fallbackProvider = fallbackApiKey
      ? new OpenRouterProvider({ apiKey: fallbackApiKey, baseUrl: fallbackBaseUrl, model: fallbackModel })
      : undefined;

    this.handlerDeps = {
      productRepo: this.productRepo,
      stockRepo: this.stockRepo,
      cartRepo: this.cartRepo,
      prisma: this.prisma,
      merchantRepo: this.merchantRepo,
      supportHandoff: this.supportHandoff,
      searchFederatedProducts: this.searchFederatedProducts,
      listEligibleCrossSells: this.listEligibleCrossSells,
      loadCrossSellConfig: this.loadCrossSellConfig.bind(this),
      crossSellPromotionRepo: this.crossSellPromotionRepo,
      applyCouponUseCase: this.applyCouponUseCase,
      couponRepo: this.couponRepo,
    };

    const placeholderHandlers: StoreToolHandlers = {} as any;
    this.agent = new StorefrontLangGraphAgent({
      provider,
      fallbackProvider,
      toolHandlers: placeholderHandlers,
      model: localModel,
      fastModel: localModel,
      strongModel: process.env.OPENROUTER_MODEL ?? localModel,
      budgetCents: parseInt(process.env.AGENT_BUDGET_CENTS ?? "500", 10)
    });
  }

  async generateNudge(input: NudgeCopyInput): Promise<string> {
    return this.copyService.generateNudge(input);
  }
  async reply(input: StorefrontConversationInput): Promise<StorefrontConversationOutput> {
    const ctx: ToolRequestContext = {
      merchantId: input.merchantId,
      sessionId: input.cartId || input.sessionId,
      buyer: input.buyerContext,
    };
    const deviceMeta = input.deviceType ? { device: input.deviceType } : undefined;
    this.emitFunnelEvent(input.merchantId, input.sessionId, "checkout_started", deviceMeta).catch(() => {});
    const shortcutHandlers = composeStoreToolHandlers(this.handlerDeps, ctx);
    const shortcut = await resolveDeterministicShortcut(
      {
        productRepo: this.productRepo,
        copyService: this.copyService,
        emitFunnelEvent: this.emitFunnelEvent.bind(this),
        applyCoupon: (args) => shortcutHandlers.applyCoupon(args),
        // Build an updated cart_summary block after a deterministic coupon apply
        // so the storefront cart store (CartFAB drawer) refreshes its discount /
        // net total. Without this the coupon persists server-side but the drawer
        // shows the stale pre-discount total (buyer told "applied", sees full price).
        getCartBlock: async (cartId: string) => {
          try {
            const cart = await shortcutHandlers.getCart({ cartId }) as any;
            if (!cart?.items?.length) return null;
            const discount = cart.discount ?? 0;
            return {
              type: "cart_summary",
              data: {
                cartId: cart.cartId ?? cartId,
                items: cart.items.map((i: any) => ({
                  variantId: i.variantId,
                  productName: i.name,
                  quantity: i.quantity,
                  price: i.unitPrice,
                  subtotal: i.lineTotal ?? (i.unitPrice ?? 0) * (i.quantity ?? 1),
                })),
                itemCount: cart.itemCount,
                subtotal: cart.total,
                discount,
                couponCode: cart.couponCode ?? null,
                freeShipping: cart.freeShipping ?? false,
                total: (cart.total ?? 0) - discount,
              },
            } as ConversationBlock;
          } catch {
            return null;
          }
        },
      },
      input,
    );
    if (shortcut) return shortcut;
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
      buyerContext: input.buyerContext,
      systemPrompt: input.experimentSystemPrompt,
      toolHandlers: composeStoreToolHandlers(this.handlerDeps, ctx),
    });
    this.emitToolFunnelEvents(input.merchantId, input.sessionId, result.toolsUsed, deviceMeta).catch(() => {});
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
      } catch {}
    }
    const PRIORITY_TOOLS = new Set([
      "compare_products", "get_product_details", "add_item_to_cart", "get_reviews",
      "create_review", "get_product_questions", "create_question", "get_similar_products",
      "add_to_wishlist", "get_wishlist", "quote_shipping", "create_checkout_session",
      "track_order", "get_invoice", "cancel_order", "escalate_to_human", "get_faq",
      "get_store_policies", "get_buyer_profile", "get_daily_deals"
    ]);
    const priorityTool = [...result.toolsUsed].reverse().find((t: string) => PRIORITY_TOOLS.has(t));
    const lastTool = priorityTool ?? result.toolsUsed[result.toolsUsed.length - 1] ?? null;
    let shippingOptions: StorefrontShippingOption[] | undefined;
    if (lastTool === "quote_shipping" && (result as any).shippingOptions) {
      shippingOptions = (result as any).shippingOptions.map((opt: any) => ({
        carrier: opt.carrier,
        name: opt.name,
        price: opt.price,
        days: opt.days
      }));
    }
    let quickRepliesConfig: StoreQuickRepliesConfig | null = null;
    if (input.storeSettings?.quick_replies) {
      try {
        quickRepliesConfig = input.storeSettings.quick_replies as StoreQuickRepliesConfig;
      } catch {}
    }
    let finalMessage = result.message;
    if ((!finalMessage || finalMessage.trim().length === 0) && result.blocks && result.blocks.length > 0) {
      const contextHint = this.blockContextHint(result.blocks, result.toolsUsed);
      finalMessage = await this.copyService.generateVariantCopy(
        input.experimentSystemPrompt,
        `Você acabou de mostrar ${contextHint} para o cliente. Escreva 1 frase curta e natural acompanhando a apresentação. Não repita dados do componente (preço, nome). Seja empático e conversacional.`,
        this.defaultBlockIntro(result.toolsUsed),
      );
    }
    const couponListBlock = (result.blocks ?? []).find((b: any) => b.type === "coupon_list") as any;
    const listedCouponCodes: string[] | undefined = couponListBlock?.data?.coupons
      ?.map((c: any) => c.code)
      .filter(Boolean);
    return {
      message: finalMessage,
      blocks: result.blocks,
      cartId: result.cartId,
      suggestedNext: storefrontQuickReplies(lastTool, quickRepliesConfig, cartState, shippingOptions, input.userMessage, listedCouponCodes)
    };
  }
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
      await this.prisma.checkoutSession.update({
        where: { merchantId_sessionId: { merchantId, sessionId } },
        data: { updatedAt: new Date() }
      });
    }
  }
  private async emitFunnelEvent(merchantId: string, sessionId: string, eventName: string, metadata?: Record<string, unknown>): Promise<void> {
    try {
      await this.ensureCheckoutSession(merchantId, sessionId);
      const existing = await this.prisma.checkoutEvent.findFirst({
        where: { merchantId, sessionId, eventName }
      });
      if (!existing) {
        await this.prisma.checkoutEvent.create({
          data: { merchantId, sessionId, eventName, occurredAt: new Date(), metadata: metadata as any }
        });
      }
    } catch {}
  }
  private async emitToolFunnelEvents(merchantId: string, sessionId: string, toolsUsed: string[], meta?: Record<string, unknown>): Promise<void> {
    if (toolsUsed.includes("search_products") || toolsUsed.includes("get_product_details")) {
      await this.emitFunnelEvent(merchantId, sessionId, "product_viewed", meta);
    }
    if (toolsUsed.includes("add_item_to_cart")) {
      await this.emitFunnelEvent(merchantId, sessionId, "cart_viewed", meta);
    }
    if (toolsUsed.includes("quote_shipping")) {
      await this.emitFunnelEvent(merchantId, sessionId, "shipping_option_selected", meta);
    }
    if (toolsUsed.includes("apply_coupon")) {
      await this.emitFunnelEvent(merchantId, sessionId, "coupon_applied", meta);
    }
    if (toolsUsed.includes("create_checkout_session")) {
      await this.emitFunnelEvent(merchantId, sessionId, "payment_method_selected", meta);
    }
  }
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
        // No hardcoded coupon code (was a fake "ZYON10"). Codes vary per merchant
        // and come from the real list_promotions result, not a canned quick-reply.
        return ["Ver carrinho", "Finalizar compra"];
      default:
        return cartId
          ? ["Ver meu carrinho", "Buscar produtos", "Promoções disponíveis"]
          : ["O que vocês vendem?", "Tem promoção?", "Buscar produto"];
    }
  }
  private async loadCrossSellConfig(merchantId: string): Promise<{ enabled: boolean; touchpoints: { browsing: boolean; pre_cart: boolean; pre_payment: boolean; post_purchase: boolean }; discount: { enabled: boolean; mode: string; percent: number; couponCode?: string }; limits: { maxSuggestionsPerSession: number; cooldownSeconds: number }; strategies: string[]; display: { mode: string } }> {
    try {
      const merchant = await this.prisma.merchant.findUnique({ where: { id: merchantId }, select: { storeSettings: true } });
      const settings = (merchant?.storeSettings as Record<string, any>) ?? {};
      const cs = settings.crossSell ?? {};
      return {
        enabled: cs.enabled ?? false,
        touchpoints: { browsing: cs.touchpoints?.browsing ?? true, pre_cart: cs.touchpoints?.pre_cart ?? false, pre_payment: cs.touchpoints?.pre_payment ?? true, post_purchase: cs.touchpoints?.post_purchase ?? false },
        discount: { enabled: cs.discount?.enabled ?? false, mode: cs.discount?.mode ?? "percent", percent: cs.discount?.percent ?? 10, couponCode: cs.discount?.couponCode },
        limits: { maxSuggestionsPerSession: cs.limits?.maxSuggestionsPerSession ?? 2, cooldownSeconds: cs.limits?.cooldownSeconds ?? 120 },
        strategies: cs.strategies ?? ["same_category", "ai_personalized"],
        display: { mode: cs.display?.mode ?? "interstitial" },
      };
    } catch {
      return { enabled: false, touchpoints: { browsing: true, pre_cart: false, pre_payment: true, post_purchase: false }, discount: { enabled: false, mode: "percent", percent: 10 }, limits: { maxSuggestionsPerSession: 2, cooldownSeconds: 120 }, strategies: ["same_category", "ai_personalized"], display: { mode: "interstitial" } };
    }
  }
}
