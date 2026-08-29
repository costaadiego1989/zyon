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
import type { ProductRepositoryPort, StockRepositoryPort } from "../../../catalog/domain/ports/product-repository.port.js";
import { STOREFRONT_CART_PORT, type StorefrontCartPort } from "../../domain/ports/storefront-cart.port.js";
import { storefrontQuickReplies, type StorefrontCartState, type StorefrontShippingOption } from "../../domain/services/storefront-quick-replies.service.js";
import type { StoreQuickRepliesConfig } from "@zyon/shared-types";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { SupportHandoffService } from "../../../support/application/support-handoff.service.js";
import { AgentCopyService } from "../copy/agent-copy.service.js";

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

  /**
   * When an A/B experiment prompt is active, generate the short intro copy with
   * the variant's tone instead of a hardcoded string. Keeps deterministic blocks
   * fast while still letting the experiment influence the agent's communication.
   * Falls back to the provided default text on any failure or when no experiment.
   */
  async generateNudge(input: NudgeCopyInput): Promise<string> {
    return this.copyService.generateNudge(input);
  }

  async reply(input: StorefrontConversationInput): Promise<StorefrontConversationOutput> {
    const ctx: ToolRequestContext = {
      merchantId: input.merchantId,
      sessionId: input.cartId || input.sessionId,
      buyer: input.buyerContext,
    };

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
          const introMessage = await this.copyService.generateVariantCopy(
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
          const detailMessage = await this.copyService.generateVariantCopy(
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
      buyerContext: input.buyerContext,
      systemPrompt: input.experimentSystemPrompt,
      toolHandlers: composeStoreToolHandlers(this.handlerDeps, ctx),
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
      finalMessage = await this.copyService.generateVariantCopy(
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

  private async loadCrossSellConfig(merchantId: string): Promise<{ enabled: boolean; touchpoints: { browsing: boolean; pre_cart: boolean; pre_payment: boolean; post_purchase: boolean }; discount: { enabled: boolean; mode: string; percent: number; couponCode?: string }; limits: { maxSuggestionsPerSession: number; cooldownSeconds: number }; strategies: string[] }> {
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
      };
    } catch {
      return { enabled: false, touchpoints: { browsing: true, pre_cart: false, pre_payment: true, post_purchase: false }, discount: { enabled: false, mode: "percent", percent: 10 }, limits: { maxSuggestionsPerSession: 2, cooldownSeconds: 120 }, strategies: ["same_category", "ai_personalized"] };
    }
  }
}
