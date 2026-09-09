import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Optional, Param, Patch, Post, Query, Req, Res, UnauthorizedException, UseGuards } from "@nestjs/common";
import { RealtimeCapabilityService } from "../../../../shared/auth/realtime-capability.js";
import { NonProductionRoute, ProductionDisabledRoute, ProductionRoute } from "../../../../shared/http/non-production-route.js";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { MerchantOwnershipGuard } from "../../../auth/presentation/merchant-ownership.guard.js";
import { currentTenantPrincipal, type TenantPrincipalRequest } from "../../../../shared/auth/tenant-principal.js";
import { StartStoreConversationUseCase } from "../../application/use-cases/start-store-conversation.use-case.js";
import { SendStoreMessageUseCase } from "../../application/use-cases/send-store-message.use-case.js";
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

export interface StartConversationRequest {
  merchant_id: string;
  initial_message?: string;
}

export interface SendMessageRequest {
  user_message: string;
  cart_id?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

@Controller("storefront")
export class StorefrontController {
  constructor(
    private readonly startStoreConversation: StartStoreConversationUseCase,
    private readonly sendStoreMessage: SendStoreMessageUseCase,
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
    @Optional() @Inject(PRODUCT_PROMOTION_REPOSITORY) private readonly productPromotionRepo?: ProductPromotionRepositoryPort,
  ) {}

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
  async startConversation(@Body() body: StartConversationRequest, @Req() request: { headers?: { origin?: string } }) {
    const result = await this.startStoreConversation.execute(body);
    const access = this.capabilities.issue({ purpose: "storefront-conversation", merchantId: result.merchant_id, resourceId: result.conversation_id, origin: request.headers?.origin });
    return { ...result, conversation_token: access.token, conversation_token_expires_at: access.expiresAt };
  }

  @Post("conversations/:conversationId/messages")
  async sendMessage(
    @Param("conversationId") conversationId: string,
    @Body() body: SendMessageRequest & { merchant_id?: string },
    @Req() request: { headers?: { authorization?: string; origin?: string } },
  ) {
    const claims = this.conversationAccess(request, conversationId, body.merchant_id);
    if (body.cart_id !== undefined && body.cart_id !== claims.resourceId) throw new ForbiddenException("conversation_cart_mismatch");
    return this.sendStoreMessage.execute({
      merchant_id: claims.merchantId,
      conversation_id: claims.resourceId,
      user_message: body.user_message,
      cart_id: claims.resourceId,
      history: body.history,
    });
  }

  @Post("conversations/:conversationId/access")
  renewConversationAccess(
    @Param("conversationId") conversationId: string,
    @Req() request: { headers?: { authorization?: string; origin?: string } },
  ) {
    const token = request.headers?.authorization?.match(/^Bearer (\S+)$/i)?.[1];
    try {
      const access = this.capabilities.renewConversation(token, conversationId, request.headers?.origin);
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
    @Req() request: { headers?: { authorization?: string; origin?: string } },
  ) {
    const claims = this.conversationAccess(request, conversationId, body.merchant_id);
    body = { ...body, merchant_id: claims.merchantId };
    if (!body.merchant_id || !body.event) {
      throw new BadRequestException("merchant_id and event required");
    }

    await this.trackStorefrontEvent.execute({
      merchantId: body.merchant_id,
      conversationId,
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
      range: from && to ? { from, to } : undefined
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
    const cart = await this.cartRepo.getOrCreate(merchantId, cartId);
    // Apply product-promo pricing on read; base price is fresh from DB.
    const promoMeta = await applyProductPromoPricing(this.productPromotionRepo, merchantId, cart);
    return {
      cartId: cart.sessionId,
      items: cart.items.map((i) => {
        const badge = promoMeta.get(i.variantId);
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
      total: cart.total / 100,
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
    const cart = await this.cartRepo.updateItemQuantity(merchantId, cartId, variantId, body.quantity);
    const promoMeta = await applyProductPromoPricing(this.productPromotionRepo, merchantId, cart);
    return {
      cartId: cart.sessionId,
      items: cart.items.map((i) => {
        const badge = promoMeta.get(i.variantId);
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
      total: cart.total / 100,
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
  async handleCreateBudgetRequest(@Body() body: {
    merchant_id: string;
    customer_name: string;
    customer_email: string;
    customer_phone: string;
    items: Array<{ variantId: string; productName: string; quantity: number; price: number }>;
    total: number;
    note?: string;
  }) {
    return this.createBudgetRequest.execute({
      merchantId: body.merchant_id,
      customerName: body.customer_name,
      customerEmail: body.customer_email,
      customerPhone: body.customer_phone,
      items: body.items,
      total: body.total,
      note: body.note,
    });
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

  private conversationAccess(request: { headers?: { authorization?: string; origin?: string } }, conversationId: string, merchantId?: string) {
    const authorization = request.headers?.authorization;
    const token = typeof authorization === "string" && authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : undefined;
    let claims;
    try { claims = this.capabilities.verify(token, "storefront-conversation", request.headers?.origin); }
    catch { throw new UnauthorizedException("invalid_conversation_token"); }
    if (claims.resourceId !== conversationId || (merchantId !== undefined && claims.merchantId !== merchantId)) {
      throw new ForbiddenException("conversation_access_denied");
    }
    return claims;
  }
}
