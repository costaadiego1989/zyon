import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Optional, Param, Patch, Post, Query, Req, Res, UnauthorizedException, UseGuards } from "@nestjs/common";
import { AiUserIdentityService } from "../../../../shared/http/ai-user-identity.service.js";
import { AiUserRateLimitService } from "../../../../shared/http/ai-user-rate-limit.service.js";
import { HttpException, HttpStatus } from "@nestjs/common";
import { RealtimeCapabilityService } from "../../../../shared/auth/realtime-capability.js";
import { NonProductionRoute, ProductionDisabledRoute, ProductionRoute } from "../../../../shared/http/non-production-route.js";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { MerchantOwnershipGuard } from "../../../auth/presentation/merchant-ownership.guard.js";
import { currentTenantPrincipal, type TenantPrincipalRequest } from "../../../../shared/auth/tenant-principal.js";
import { StartStoreConversationUseCase } from "../../application/use-cases/start-store-conversation.use-case.js";
import { SendStoreMessageUseCase } from "../../application/use-cases/send-store-message.use-case.js";
import { StorefrontAttachmentInterpreter, type StorefrontConversationAttachment } from "../../application/services/storefront-attachment-interpreter.service.js";
import { RequestTimeout } from "../../../../shared/http/request-timeout.interceptor.js";
import { GenerateNudgeUseCase } from "../../application/use-cases/generate-nudge.use-case.js";
import { GetConversationHistoryUseCase } from "../../application/use-cases/get-conversation-history.use-case.js";
import { GetStoreConfigUseCase } from "../../application/use-cases/get-store-config.use-case.js";
import { GetStorefrontFunnelUseCase } from "../../application/use-cases/get-storefront-funnel.use-case.js";
import { CreateBudgetRequestUseCase } from "../../application/use-cases/create-budget-request.use-case.js";
import { ListBudgetRequestsUseCase } from "../../application/use-cases/list-budget-requests.use-case.js";
import { UpdateBudgetRequestStatusUseCase } from "../../application/use-cases/update-budget-request-status.use-case.js";
import { SearchMarketplaceProductsStorefrontUseCase } from "../../application/use-cases/search-marketplace-products-storefront.use-case.js";
import { AddMarketplaceItemToCartStorefrontUseCase } from "../../application/use-cases/add-marketplace-item-to-cart.use-case.js";
import { GetPublicStoreResourcesUseCase } from "../../application/use-cases/get-public-store-resources.use-case.js";
import { TrackStorefrontEventUseCase } from "../../application/use-cases/track-storefront-event.use-case.js";
import { GetStorefrontLiveSessionsUseCase } from "../../application/use-cases/get-storefront-live-sessions.use-case.js";
import { STOREFRONT_CART_PORT, type StorefrontCartPort } from "../../domain/ports/storefront-cart.port.js";
import { PRODUCT_PROMOTION_REPOSITORY, type ProductPromotionRepositoryPort } from "../../../catalog/domain/ports/product-promotion-repository.port.js";
import { applyProductPromoPricing } from "../../infrastructure/pricing/storefront-cart-promo.pricing.js";
import { ListPublicStorefrontProductsUseCase } from "../../../catalog/application/use-cases/list-public-storefront-products.use-case.js";
import { BuyerJwtService } from "../../../buyer-account/domain/services/buyer-jwt.service.js";
import { OneBuyClickSessionService } from "../../application/services/one-buy-click-session.service.js";

import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { PrismaClient } from "@prisma/client";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import { reevaluateCartRules } from "../../infrastructure/tool-handlers/cart.handlers.js";
import type { StorefrontCart } from "../../domain/ports/storefront-cart.port.js";
import { StorefrontConversationRateLimitService } from "../../application/services/storefront-conversation-rate-limit.service.js";

import { CHECKOUT_CROSS_SELL_RECOMMENDER, type CheckoutCrossSellRecommenderPort } from "../../../checkout/domain/ports/cross-sell-recommender.port.js";

export interface StartConversationRequest {
  merchant_id: string;
  initial_message?: string;
  ai_user_token?: string;
  buyer_access_token?: string;
}

export interface SendMessageRequest {
  user_message: string;
  voice_turn_token?: string;
  cart_id?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  attachment?: StorefrontConversationAttachment;
}

@Controller("storefront")
export class StorefrontController {
  constructor(
    private readonly startStoreConversation: StartStoreConversationUseCase,
    private readonly sendStoreMessage: SendStoreMessageUseCase,
    private readonly attachmentInterpreter: StorefrontAttachmentInterpreter,
    private readonly generateNudge: GenerateNudgeUseCase,
    private readonly getConversationHistory: GetConversationHistoryUseCase,
    private readonly getStoreConfig: GetStoreConfigUseCase,
    private readonly getStorefrontFunnel: GetStorefrontFunnelUseCase,
    private readonly createBudgetRequest: CreateBudgetRequestUseCase,
    private readonly listBudgetRequests: ListBudgetRequestsUseCase,
    private readonly updateBudgetStatus: UpdateBudgetRequestStatusUseCase,
    private readonly searchMarketplace: SearchMarketplaceProductsStorefrontUseCase,
    private readonly addMarketplaceItem: AddMarketplaceItemToCartStorefrontUseCase,
    private readonly getPublicStoreResources: GetPublicStoreResourcesUseCase,
    private readonly trackStorefrontEvent: TrackStorefrontEventUseCase,
    private readonly getStorefrontLiveSessions: GetStorefrontLiveSessionsUseCase,
    private readonly publicCatalog: ListPublicStorefrontProductsUseCase,
    @Inject(STOREFRONT_CART_PORT) private readonly cartRepo: StorefrontCartPort,
    @Inject(RealtimeCapabilityService) private readonly capabilities: RealtimeCapabilityService,
    private readonly conversationRateLimiter: StorefrontConversationRateLimitService,
    @Optional() @Inject(PRODUCT_PROMOTION_REPOSITORY) private readonly productPromotionRepo?: ProductPromotionRepositoryPort,
    @Optional() @Inject(PRISMA_CLIENT) private readonly prisma?: PrismaClient,
    @Optional() @Inject(MERCHANT_REPOSITORY) private readonly merchantRepo?: MerchantRepository,
    @Optional() private readonly buyerJwt?: BuyerJwtService,
    @Optional() private readonly oneBuyClick?: OneBuyClickSessionService,
    @Optional() private readonly aiIdentity?: AiUserIdentityService,
    @Optional() private readonly aiUserLimiter?: AiUserRateLimitService,
    @Optional() @Inject(CHECKOUT_CROSS_SELL_RECOMMENDER) private readonly crossSellRecommender?: CheckoutCrossSellRecommenderPort,
  ) {}

  private async priceCart(merchantId: string, cartId: string, cart: StorefrontCart) {
    if (this.prisma && this.merchantRepo) {
      return reevaluateCartRules({ prisma: this.prisma, merchantRepo: this.merchantRepo, cartRepo: this.cartRepo, productPromotionRepo: this.productPromotionRepo }, merchantId, cartId, cart);
    }
    return { cart, promoMeta: await applyProductPromoPricing(this.productPromotionRepo, merchantId, cart), nextNudge: null, activeRules: [] };
  }

  @Get("index")
  async getStoreIndex() {
    return this.getPublicStoreResources.listIndex();
  }

  @Get("catalog/:merchantId/products")
  async listPublicCatalog(
    @Param("merchantId") merchantId: string,
    @Query("query") query?: string,
    @Query("categoryId") categoryId?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const parsedLimit = Number(limit);
    return this.publicCatalog.execute({
      merchantId,
      query,
      categoryId,
      cursor,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
    });
  }

  @Get("catalog/:merchantId/products/:productId")
  async getPublicCatalogProduct(
    @Param("merchantId") merchantId: string,
    @Param("productId") productId: string,
  ) {
    return this.publicCatalog.get(merchantId, productId);
  }

  @Get(":slug/config")
  async getConfig(@Param("slug") slug: string) {
    return this.getStoreConfig.execute(slug);
  }

  @Get(":slug/stories")
  async getStories(@Param("slug") slug: string) {
    return this.getPublicStoreResources.storiesForSlug(slug);
  }

  @Get(":slug/logo")
  async getLogo(@Param("slug") slug: string, @Res() res: any) {
    const logoUrl = await this.getPublicStoreResources.logoForSlug(slug);

    if (logoUrl.startsWith("data:")) {
      const match = logoUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (!match) throw new NotFoundException("logo_invalid");
      const contentType = match[1];
      const buffer = Buffer.from(match[2], "base64");
      res.set("Content-Type", contentType);
      res.set("Cache-Control", "public, max-age=86400");
      res.send(buffer);
      return;
    }
    res.redirect(301, logoUrl);
  }

  @Get(":slug/coupons")
  async getCoupons(@Param("slug") slug: string) {
    return this.getPublicStoreResources.couponsForSlug(slug);
  }

  @Post("conversations")
  async startConversation(
    @Body() body: StartConversationRequest,
    @Req() request: { headers?: { origin?: string; "x-trusted-storefront-origin"?: string | string[]; "x-internal-service-token"?: string | string[] } },
  ) {
    const identity = (this.aiIdentity ?? new AiUserIdentityService()).resolve({ visitorToken: body.ai_user_token, buyerToken: body.buyer_access_token, merchantId: body.merchant_id });
    const result = await this.startStoreConversation.execute(body);
    const access = this.capabilities.issue({
      purpose: "storefront-conversation",
      merchantId: result.merchant_id,
      resourceId: result.conversation_id,
      origin: storefrontOrigin(request),
      aiUserId: identity.userId,
    });
    return { ...result, conversation_token: access.token, conversation_token_expires_at: access.expiresAt, ai_user_token: identity.token };
  }

  @Post("conversations/:conversationId/messages")
  @RequestTimeout(60_000)
  async sendMessage(
    @Param("conversationId") conversationId: string,
    @Body() body: SendMessageRequest & { merchant_id?: string },
    @Req() request: { headers?: { authorization?: string; origin?: string; "x-buyer-authorization"?: string | string[] } },
    @Res({ passthrough: true }) response?: { setHeader(name: string, value: string): void },
  ) {
    const claims = this.conversationAccess(request, conversationId, body.merchant_id);
    if (body.cart_id !== undefined && body.cart_id !== claims.resourceId) throw new ForbiddenException("conversation_cart_mismatch");
    const globalUserId = this.buyerId(request, claims.merchantId);
    const userId = globalUserId ? `buyer:${globalUserId}` : claims.aiUserId;
    if (!userId) throw new UnauthorizedException("ai_user_identity_required");
    const admittedVoice = await this.aiUserLimiter?.consumeVoicePermit(body.voice_turn_token, { userId, merchantId: claims.merchantId, resourceId: claims.resourceId, origin: request.headers?.origin });
    if (body.voice_turn_token && !admittedVoice) throw new UnauthorizedException("invalid_voice_turn_token");
    if (!admittedVoice) {
      const rateLimit = await this.conversationRateLimiter.consume(claims.merchantId, claims.resourceId, userId);
      response?.setHeader("X-AI-RateLimit-Limit", String(rateLimit.limit));
      response?.setHeader("X-AI-RateLimit-Remaining", String(rateLimit.remaining));
      response?.setHeader("X-AI-RateLimit-Reset", String(Math.ceil(rateLimit.resetAt / 1000)));
      if (!rateLimit.allowed) {
        const retryAfterSeconds = Math.max(Math.ceil(rateLimit.retryAfterMs / 1000), 1);
        response?.setHeader("Retry-After", String(retryAfterSeconds));
        throw new HttpException({ code: "ai_interaction_rate_limited", scope: "user", retry_after_seconds: retryAfterSeconds }, HttpStatus.TOO_MANY_REQUESTS);
      }
    }
    const attachmentContext = await this.attachmentInterpreter.interpret(body.attachment);
    const oneBuyClick = this.oneBuyClick
      ? await this.oneBuyClick.get({
          merchantId: claims.merchantId,
          conversationId: claims.resourceId,
          globalUserId,
        })
      : undefined;    return this.sendStoreMessage.execute({
      merchant_id: claims.merchantId,
      conversation_id: claims.resourceId,
      user_message: body.user_message,
      cart_id: claims.resourceId,
      history: body.history,
      attachment_context: attachmentContext,
      global_user_id: globalUserId,
      one_buy_click: oneBuyClick,
    });
  }

  @Get("conversations/:conversationId/one-buy-click")
  async getOneBuyClick(
    @Param("conversationId") conversationId: string,
    @Req() request: { headers?: { authorization?: string; origin?: string; "x-buyer-authorization"?: string | string[] } },
  ) {
    const claims = this.conversationAccess(request, conversationId);
    return this.requireOneBuyClick().get({
      merchantId: claims.merchantId,
      conversationId: claims.resourceId,
      globalUserId: this.buyerId(request, claims.merchantId),
    });
  }

  @Patch("conversations/:conversationId/one-buy-click")
  async configureOneBuyClick(
    @Param("conversationId") conversationId: string,
    @Body() body: { enabled?: unknown },
    @Req() request: { headers?: { authorization?: string; origin?: string; "x-buyer-authorization"?: string | string[] } },
  ) {
    if (typeof body.enabled !== "boolean") throw new BadRequestException("one_buy_click_enabled_must_be_boolean");
    const claims = this.conversationAccess(request, conversationId);
    const globalUserId = this.buyerId(request, claims.merchantId);
    if (body.enabled && !globalUserId) throw new UnauthorizedException("one_buy_click_auth_required");
    return this.requireOneBuyClick().configure({
      merchantId: claims.merchantId,
      conversationId: claims.resourceId,
      enabled: body.enabled,
      globalUserId,
    });
  }

  @Post("conversations/:conversationId/access")
  renewConversationAccess(
    @Param("conversationId") conversationId: string,
    @Req() request: { headers?: { authorization?: string; origin?: string; "x-trusted-storefront-origin"?: string | string[]; "x-internal-service-token"?: string | string[]; "x-ai-user-token"?: string; "x-buyer-authorization"?: string } },
  ) {
    const token = request.headers?.authorization?.match(/^Bearer (\S+)$/i)?.[1];
    try {
      const access = this.capabilities.renewConversation(token, conversationId, storefrontOrigin(request));
      const claims = this.capabilities.verify(access.token, "storefront-conversation", storefrontOrigin(request));
      if (!claims.aiUserId) {
        const buyerToken = request.headers?.["x-buyer-authorization"]?.match(/^Bearer (\S+)$/i)?.[1];
        const identity = (this.aiIdentity ?? new AiUserIdentityService()).resolve({ visitorToken: request.headers?.["x-ai-user-token"], buyerToken, merchantId: claims.merchantId });
        const migrated = this.capabilities.renewConversation(access.token, conversationId, storefrontOrigin(request), Math.floor(Date.now() / 1000), identity.userId);
        return { conversation_id: conversationId, conversation_token: migrated.token, conversation_token_expires_at: migrated.expiresAt, ai_user_token: identity.token };
      }
      return { conversation_id: conversationId, conversation_token: access.token, conversation_token_expires_at: access.expiresAt };
    } catch {
      throw new UnauthorizedException("invalid_conversation_token");
    }
  }

  @Post("nudge")
  async nudge(
    @Body() body: { conversation_id: string; merchant_id?: string; trigger: "idle_30_seconds" | "exit_intent_detected"; stage?: "cart" | "browsing"; fallback: string },
    @Req() request: { headers?: { authorization?: string; origin?: string } },
  ) {
    const claims = this.conversationAccess(request, body.conversation_id, body.merchant_id);
    if (this.aiUserLimiter) await this.aiUserLimiter.assertNudgeAllowed(claims.aiUserId!);
    return this.generateNudge.execute({
      merchant_id: claims.merchantId,
      trigger: body.trigger,
      stage: body.stage,
      fallback: body.fallback,
    });
  }

  @Get("conversations/:conversationId")
  async getHistory(
    @Param("conversationId") conversationId: string,
    @Req() request: { headers?: { authorization?: string; origin?: string } },
  ) {
    const claims = this.conversationAccess(request, conversationId);
    return this.getConversationHistory.execute({
      merchant_id: claims.merchantId,
      conversation_id: claims.resourceId,
    });
  }

  @Post("conversations/:conversationId/events")
  async trackEvent(
    @Param("conversationId") conversationId: string,
    @Body() body: { merchant_id?: string; event: string; metadata?: Record<string, unknown> },
    @Req() request: { headers?: { authorization?: string; origin?: string; "x-buyer-authorization"?: string | string[] } },
  ) {
    const claims = this.conversationAccess(request, conversationId, body.merchant_id);
    body = { ...body, merchant_id: claims.merchantId };
    if (!body.merchant_id || !body.event) {
      throw new BadRequestException("merchant_id and event required");
    }

    await this.trackStorefrontEvent.execute({
      merchantId: body.merchant_id,
      conversationId,
      globalUserId: this.buyerId(request, claims.merchantId),
      event: body.event,
      metadata: body.metadata,
    });

    return { tracked: true, event: body.event, conversation_id: conversationId };
  }

  @Get("funnel/:merchantId")
  @ProductionRoute()
  @UseGuards(AuthGuard, MerchantOwnershipGuard)
  async getFunnel(
    @Param("merchantId") merchantId: string,
    @Query("period") period?: string,
    @Query("breakdown") breakdown?: string,
    @Query("compare") compare?: string,
    @Query("from") from?: string,
    @Query("to") to?: string
  ) {
    const validPeriods = ["today", "7d", "30d", "90d"];
    const resolvedPeriod = validPeriods.includes(period ?? "") ? (period as "today" | "7d" | "30d" | "90d") : "7d";
    const validBreakdowns = ["device", "buyer_type", "payment_method"];
    const resolvedBreakdown = validBreakdowns.includes(breakdown ?? "") ? (breakdown as "device" | "buyer_type" | "payment_method") : undefined;
    const resolvedCompare = compare === "true" || compare === "1";
    return this.getStorefrontFunnel.execute(merchantId, resolvedPeriod, {
      breakdown: resolvedBreakdown,
      compare: resolvedCompare,
      range: from || to ? { from, to } : undefined
    });
  }

  @Get("funnel/:merchantId/sessions")
  @ProductionRoute()
  @UseGuards(AuthGuard, MerchantOwnershipGuard)
  async getFunnelSessions(@Param("merchantId") merchantId: string) {
    return this.getStorefrontLiveSessions.execute(merchantId);
  }

  @Get("cart/:cartId")
  async getCart(
    @Param("cartId") cartId: string,
    @Query("merchantId") merchantId: string,
    @Req() request: { headers?: { authorization?: string; origin?: string } },
  ) {
    if (!merchantId) throw new NotFoundException("merchantId query param required");
    this.conversationAccess(request, cartId, merchantId);
    const base = await this.cartRepo.getOrCreate(merchantId, cartId);
    const { cart, promoMeta, nextNudge, activeRules } = await this.priceCart(merchantId, cartId, base);
    return {
      cartId: cart.sessionId,
      items: cart.items.map((i) => {
        const badge = promoMeta?.get(i.variantId);
        return {
          variantId: i.variantId,
          productName: i.name,
          selectedServiceSlot: i.selectedServiceSlot,
          selectedServiceSlotId: i.selectedServiceSlot?.slotId,
          quantity: i.quantity,
          price: i.unitPriceCents / 100,
          subtotal: (i.unitPriceCents * i.quantity) / 100,
          imageUrl: i.imageUrl ?? undefined,
          ...(badge ? { originalPrice: badge.originalPriceCents / 100, discountPercent: badge.discountPercent, coupon: badge.coupon } : {}),
        };
      }),
      itemCount: cart.items.reduce((sum, i) => sum + i.quantity, 0),
      discount: cart.discount ? cart.discount / 100 : 0,
      subtotal: cart.total / 100,
      total: (cart.total - cart.discount) / 100,
      freeShipping: cart.freeShipping,
      nextNudge,
      activeRules,
    };
  }

  @Get("cart/:cartId/pre-checkout-suggestions")
  async preCheckoutSuggestions(
    @Param("cartId") cartId: string,
    @Query("merchantId") merchantId: string,
    @Req() request: { headers?: { authorization?: string; origin?: string } },
  ) {
    if (!merchantId) throw new BadRequestException("merchantId query param required");
    this.conversationAccess(request, cartId, merchantId);
    const cart = await this.cartRepo.getOrCreate(merchantId, cartId);
    if (!cart.items.length || !this.crossSellRecommender || !this.prisma) return { products: [] };
    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: cart.items.map(item => item.variantId) }, product: { merchantId } },
      select: { id: true, sku: true, product: { select: { categoryId: true, category: { select: { name: true } } } } },
    });
    const byId = new Map(variants.map(variant => [variant.id, variant]));
    const suggestions = await this.crossSellRecommender.suggest({
      merchant_id: merchantId, session_id: cartId, touchpoint: "pre_checkout",
      cart: { currency: "BRL", source: "storefront", total: (cart.total - cart.discount) / 100,
        items: cart.items.map(item => ({ sku: byId.get(item.variantId)?.sku ?? item.variantId, name: item.name,
          quantity: item.quantity, price: item.unitPriceCents / 100,
          category: byId.get(item.variantId)?.product?.category?.name ?? byId.get(item.variantId)?.product?.categoryId ?? undefined })),
      },
    });
    const cartVariantIds = new Set(cart.items.map(item => item.variantId));
    return { trigger: "Antes de finalizar, quer completar seu pedido?", products: suggestions
      .filter(product => product.variant_id && product.in_stock && !cartVariantIds.has(product.variant_id))
      .map(product => ({ id: product.variant_id!, name: product.name, price: product.unit_price,
        priceFormatted: new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(product.unit_price),
        image: product.image_url, inStock: product.in_stock === true })),
    };
  }

  @Patch("cart/:cartId/items/:variantId")
  async updateCartItem(
    @Param("cartId") cartId: string,
    @Param("variantId") variantId: string,
    @Query("merchantId") merchantId: string,
    @Body() body: { quantity: number },
    @Req() request: { headers?: { authorization?: string; origin?: string } },
  ) {
    if (!merchantId) throw new BadRequestException("merchantId query param required");
    this.conversationAccess(request, cartId, merchantId);
    if (body.quantity == null || !Number.isInteger(body.quantity) || body.quantity < 0 || body.quantity > 99) {
      throw new BadRequestException("quantity must be an integer between 0 and 99");
    }
    const base = await this.cartRepo.updateItemQuantity(merchantId, cartId, variantId, body.quantity);
    const { cart, promoMeta, nextNudge, activeRules } = await this.priceCart(merchantId, cartId, base);
    return {
      cartId: cart.sessionId,
      items: cart.items.map((i) => {
        const badge = promoMeta?.get(i.variantId);
        return {
          variantId: i.variantId,
          productName: i.name,
          quantity: i.quantity,
          price: i.unitPriceCents / 100,
          subtotal: (i.unitPriceCents * i.quantity) / 100,
          imageUrl: i.imageUrl ?? undefined,
          ...(badge ? { originalPrice: badge.originalPriceCents / 100, discountPercent: badge.discountPercent, coupon: badge.coupon } : {}),
        };
      }),
      itemCount: cart.items.reduce((sum, i) => sum + i.quantity, 0),
      discount: cart.discount ? cart.discount / 100 : 0,
      subtotal: cart.total / 100,
      total: (cart.total - cart.discount) / 100,
      freeShipping: cart.freeShipping,
      nextNudge,
      activeRules,
    };
  }

  @Post("cart/:cartId/clear")
  async clearCart(
    @Param("cartId") cartId: string,
    @Query("merchantId") merchantId: string,
    @Req() request: { headers?: { authorization?: string; origin?: string } },
  ) {
    if (!merchantId) throw new NotFoundException("merchantId query param required");
    this.conversationAccess(request, cartId, merchantId);
    const cart = await this.cartRepo.clear(merchantId, cartId);
    return { cartId: cart.sessionId, items: [], itemCount: 0, discount: 0, total: 0 };
  }

  @Get("marketplace/search")
  async handleMarketplaceSearch(
    @Query("query") query: string,
    @Query("merchantId") merchantId?: string,
    @Query("category") category?: string,
    @Query("limit") limitRaw?: string
  ) {
    if (!query?.trim()) {
      return { products: [] };
    }

    if (!merchantId?.trim()) {
      return { products: [] };
    }

    const parsed = Number(limitRaw ?? "10");
    const limit = Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, 100)) : 10;

    return this.searchMarketplace.execute({
      merchantId,
      query: query.trim(),
      category,
      limit,
    });
  }

  @Post("marketplace/items")
  @ProductionDisabledRoute()
  async handleAddMarketplaceItem(
    @Body()
    body: {
      merchant_id: string;
      session_id: string;
      seller_merchant_id: string;
      federated_product_id: string;
      quantity: number;
      unit_price_cents: number;
    }
  ) {
    if (!body.session_id?.trim() || !body.seller_merchant_id?.trim()) {
      throw new BadRequestException("session_id and seller_merchant_id required");
    }

    if (!body.merchant_id?.trim()) {
      throw new BadRequestException("merchant_id required");
    }

    return this.addMarketplaceItem.execute({
      merchantId: body.merchant_id,
      checkoutSessionId: body.session_id,
      sellerMerchantId: body.seller_merchant_id,
      federatedProductId: body.federated_product_id,
      quantity: body.quantity ?? 1,
      unitPriceCents: body.unit_price_cents ?? 0,
    });
  }

  @Post("budget-requests")
  @ProductionRoute()
  async handleCreateBudgetRequest(@Body() body: {
    merchant_id: string;
    cart_id: string;
    customer_name: string;
    customer_email: string;
    customer_phone: string;
    note?: string;
  }, @Req() request: { headers?: { authorization?: string; origin?: string } }) {
    const access = this.conversationAccess(request, body.cart_id, body.merchant_id);
    if (!(await this.conversationRateLimiter.consume(access.merchantId, body.cart_id, access.aiUserId)).allowed) throw new HttpException("conversation_rate_limit_exceeded", HttpStatus.TOO_MANY_REQUESTS);
    const storedCart = await this.cartRepo.getOrCreate(access.merchantId, body.cart_id);
    const { cart } = await this.priceCart(access.merchantId, body.cart_id, storedCart);
    const budget = await this.createBudgetRequest.execute({
      merchantId: body.merchant_id,
      customerName: body.customer_name,
      customerEmail: body.customer_email,
      customerPhone: body.customer_phone,
      items: cart.items.map((item) => ({ variantId: item.variantId, productName: item.name, quantity: item.quantity, price: item.unitPriceCents / 100 })),
      total: Math.max(0, cart.total - cart.discount) / 100,
      note: body.note,
    });
    await this.cartRepo.clear(access.merchantId, body.cart_id);
    return budget;
  }

  @Get("budget-requests")
  @ProductionRoute()
  @UseGuards(AuthGuard)
  async handleListBudgetRequests(@Req() request: TenantPrincipalRequest, @Query("merchantId") requestedMerchantId?: string) {
    const merchantId = currentTenantPrincipal(request).tenantId;
    if (requestedMerchantId && requestedMerchantId !== merchantId) throw new ForbiddenException("cross_tenant_access_denied");
    return this.listBudgetRequests.execute(merchantId);
  }

  @Post("budget-requests/:id/status")
  @ProductionRoute()
  @UseGuards(AuthGuard)
  async handleUpdateBudgetStatus(
    @Param("id") id: string,
    @Body() body: { status: "approved" | "rejected" | "responded" },
    @Req() request: TenantPrincipalRequest,
  ) {
    return this.updateBudgetStatus.execute(id, body.status, currentTenantPrincipal(request).tenantId);
  }

  private conversationAccess(request: { headers?: { authorization?: string; origin?: string; "x-trusted-storefront-origin"?: string | string[]; "x-internal-service-token"?: string | string[] } }, conversationId: string, merchantId?: string) {
    const authorization = request.headers?.authorization;
    const token = typeof authorization === "string" && authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : undefined;
    let claims;
    try { claims = this.capabilities.verify(token, "storefront-conversation", storefrontOrigin(request)); }
    catch { throw new UnauthorizedException("invalid_conversation_token"); }
    if (claims.resourceId !== conversationId || (merchantId !== undefined && claims.merchantId !== merchantId)) {
      throw new ForbiddenException("conversation_access_denied");
    }
    return claims;
  }

  private buyerId(
    request: { headers?: { "x-buyer-authorization"?: string | string[] } },
    merchantId: string,
  ): string | undefined {
    if (!this.buyerJwt) return undefined;
    const header = request.headers?.["x-buyer-authorization"];
    const value = Array.isArray(header) ? header[0] : header;
    const token = value?.match(/^Bearer (\S+)$/i)?.[1];
    if (!token) return undefined;
    try {
      const buyer = this.buyerJwt.verify(token);
      return buyer.merchantId && buyer.merchantId !== merchantId ? undefined : buyer.globalUserId;
    } catch {
      return undefined;
    }
  }

  private requireOneBuyClick(): OneBuyClickSessionService {
    if (!this.oneBuyClick) throw new NotFoundException("one_buy_click_unavailable");
    return this.oneBuyClick;
  }
}

/**
 * The Next storefront proxy checks the browser Origin and authenticates to this
 * private API with INTERNAL_SERVICE_TOKEN before it can supply a forwarded
 * origin. Direct public calls can only use their regular Origin header.
 */
function storefrontOrigin(request: { headers?: { origin?: string; "x-trusted-storefront-origin"?: string | string[]; "x-internal-service-token"?: string | string[] } }): string | undefined {
  const internalToken = firstHeader(request.headers?.["x-internal-service-token"]);
  const trustedOrigin = firstHeader(request.headers?.["x-trusted-storefront-origin"]);
  if (process.env.INTERNAL_SERVICE_TOKEN && internalToken === process.env.INTERNAL_SERVICE_TOKEN && isHttpOrigin(trustedOrigin)) {
    return trustedOrigin;
  }
  return request.headers?.origin;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  const header = typeof value === "string" ? value : value?.[0];
  return header?.trim() || undefined;
}

function isHttpOrigin(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.origin === value;
  } catch {
    return false;
  }
}
