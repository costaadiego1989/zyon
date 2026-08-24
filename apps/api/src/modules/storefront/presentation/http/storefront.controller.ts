import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Patch, Post, Query, Res } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { NonProductionRoute } from "../../../../shared/http/non-production-route.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { StartStoreConversationUseCase } from "../../application/use-cases/start-store-conversation.use-case.js";
import { SendStoreMessageUseCase } from "../../application/use-cases/send-store-message.use-case.js";
import { GetConversationHistoryUseCase } from "../../application/use-cases/get-conversation-history.use-case.js";
import { GetStoreConfigUseCase } from "../../application/use-cases/get-store-config.use-case.js";
import { GetStorefrontFunnelUseCase } from "../../application/use-cases/get-storefront-funnel.use-case.js";
import { CreateBudgetRequestUseCase } from "../../application/use-cases/create-budget-request.use-case.js";
import { ListBudgetRequestsUseCase } from "../../application/use-cases/list-budget-requests.use-case.js";
import { UpdateBudgetRequestStatusUseCase } from "../../application/use-cases/update-budget-request-status.use-case.js";
import { SearchMarketplaceProductsStorefrontUseCase } from "../../application/use-cases/search-marketplace-products-storefront.use-case.js";
import { AddMarketplaceItemToCartStorefrontUseCase } from "../../application/use-cases/add-marketplace-item-to-cart.use-case.js";
import { decodePersistedTheme } from "../../../merchant/domain/services/merchant-theme.validators.js";
import { STOREFRONT_CART_PORT, type StorefrontCartPort } from "../../domain/ports/storefront-cart.port.js";

export interface StartConversationRequest {
  merchant_id: string;
  initial_message?: string;
}

export interface SendMessageRequest {
  user_message: string;
  cart_id?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

@NonProductionRoute()
@Controller("storefront")
export class StorefrontController {
  constructor(
    private readonly startStoreConversation: StartStoreConversationUseCase,
    private readonly sendStoreMessage: SendStoreMessageUseCase,
    private readonly getConversationHistory: GetConversationHistoryUseCase,
    private readonly getStoreConfig: GetStoreConfigUseCase,
    private readonly getStorefrontFunnel: GetStorefrontFunnelUseCase,
    private readonly createBudgetRequest: CreateBudgetRequestUseCase,
    private readonly listBudgetRequests: ListBudgetRequestsUseCase,
    private readonly updateBudgetStatus: UpdateBudgetRequestStatusUseCase,
    private readonly searchMarketplace: SearchMarketplaceProductsStorefrontUseCase,
    private readonly addMarketplaceItem: AddMarketplaceItemToCartStorefrontUseCase,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(STOREFRONT_CART_PORT) private readonly cartRepo: StorefrontCartPort
  ) {}

  @Get("index")
  async getStoreIndex() {
    const merchants = await this.prisma.merchant.findMany({
      where: { plan: { in: ["STORE_ONLY", "BOTH"] } },
      select: { id: true, name: true, updatedAt: true },
    });
    const stores = merchants.map((m) => ({
      slug: m.name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .trim(),
      updatedAt: m.updatedAt.toISOString(),
    }));
    return { stores };
  }

  @Get(":slug/config")
  async getConfig(@Param("slug") slug: string) {
    return this.getStoreConfig.execute(slug);
  }

  @Get(":slug/stories")
  async getStories(@Param("slug") slug: string) {
    // Resolve merchant using same logic as getStoreConfig
    let merchant = await this.prisma.merchant.findUnique({ where: { id: slug }, select: { id: true } });
    if (!merchant) {
      const all = await this.prisma.merchant.findMany({ select: { id: true, name: true, storeSettings: true } });
      const match = all.find((m) => {
        const settings = m.storeSettings as { slug?: string } | null;
        if (settings?.slug === slug) return true;
        const slugified = m.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
        return slugified === slug;
      });
      if (match) merchant = { id: match.id };
    }
    if (!merchant) return { categories: [] };
    const categories = await this.prisma.storyCategory.findMany({
      where: { merchantId: merchant.id, isArchived: false },
      include: { stories: { where: { isArchived: false }, orderBy: { sortOrder: "asc" } } },
      orderBy: { sortOrder: "asc" },
    });
    return { categories };
  }

  @Get(":slug/logo")
  async getLogo(@Param("slug") slug: string, @Res() res: any) {
    const merchant = await this.prisma.merchant.findUnique({ where: { id: slug } });
    if (!merchant) throw new NotFoundException("store_not_found");
    const theme = decodePersistedTheme(merchant.theme);
    const logoUrl = theme?.logoUrl;
    if (!logoUrl) throw new NotFoundException("logo_not_found");

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
    // External URL — redirect
    res.redirect(301, logoUrl);
  }

  @Post("conversations")
  async startConversation(@Body() body: StartConversationRequest) {
    return this.startStoreConversation.execute(body);
  }

  @Post("conversations/:conversationId/messages")
  async sendMessage(
    @Param("conversationId") conversationId: string,
    @Body() body: SendMessageRequest & { merchant_id: string }
  ) {
    return this.sendStoreMessage.execute({
      merchant_id: body.merchant_id,
      conversation_id: conversationId,
      user_message: body.user_message,
      cart_id: body.cart_id,
      history: body.history
    });
  }

  @Get("conversations/:conversationId")
  async getHistory(
    @Param("conversationId") conversationId: string,
    @Body() body: { merchant_id: string }
  ) {
    return this.getConversationHistory.execute({
      merchant_id: body.merchant_id,
      conversation_id: conversationId
    });
  }

  @Post("conversations/:conversationId/events")
  async trackEvent(
    @Param("conversationId") conversationId: string,
    @Body() body: { merchant_id: string; event: string; metadata?: Record<string, unknown> }
  ) {
    if (!body.merchant_id || !body.event) {
      throw new BadRequestException("merchant_id and event required");
    }

    try {
      // Emit to CheckoutEvent table for funnel analytics (best-effort)
      const funnelEvents = new Set([
        "auth_phone_submitted", "auth_phone_verified", "auth_identity_confirmed",
        "auth_registration_completed", "login_completed", "product_viewed", "cart_viewed",
        "cross_sell_accepted", "cross_sell_added",
      ]);
      if (funnelEvents.has(body.event)) {
        const existing = await this.prisma.checkoutEvent.findFirst({
          where: { merchantId: body.merchant_id, sessionId: conversationId, eventName: body.event },
        });
        if (!existing) {
          await this.prisma.checkoutEvent.create({
            data: { merchantId: body.merchant_id, sessionId: conversationId, eventName: body.event, occurredAt: new Date() },
          });
        }
      }

      const running = await this.prisma.promptExperiment.findFirst({
        where: { merchantId: body.merchant_id, status: "running" },
        include: { variants: true },
      });

      if (running && running.variants.length > 0) {
        let hash = 0;
        for (let i = 0; i < conversationId.length; i++) {
          hash = ((hash << 5) - hash) + conversationId.charCodeAt(i);
          hash |= 0;
        }
        const totalWeight = running.variants.reduce((sum, v) => sum + v.weight, 0);
        let target = Math.abs(hash) % totalWeight;
        let variantId: string | null = null;
        for (const variant of running.variants) {
          target -= variant.weight;
          if (target <= 0) {
            variantId = variant.id;
            break;
          }
        }

        if (variantId) {
          const stageMap: Record<string, Record<string, unknown>> = {
            conversation_started: { conversationStarted: true },
            product_viewed: { cartViewed: true },
            add_to_cart: { cartViewed: true, cartItemsAdded: { increment: 1 } },
            checkout_intent: { checkoutStarted: true },
            auth_phone_submitted: { checkoutStarted: true },
            auth_phone_verified: { checkoutStarted: true },
            auth_identity_confirmed: { checkoutStarted: true },
            auth_registration_completed: { checkoutCompleted: true },
            purchase_completed: { converted: true, checkoutCompleted: true },
          };

          const update = stageMap[body.event];
          if (update) {
            await (this.prisma as any).promptVariantResult.upsert({
              where: { variantId_sessionId: { variantId, sessionId: conversationId } },
              create: { variantId, sessionId: conversationId, converted: false, conversationStarted: true, ...update },
              update,
            });
          }
        }
      }
    } catch (err) {
      // Non-critical — never block storefront
    }

    return { tracked: true, event: body.event, conversation_id: conversationId };
  }

  @Get("funnel/:merchantId")
  async getFunnel(
    @Param("merchantId") merchantId: string,
    @Query("period") period?: string
  ) {
    const validPeriods = ["today", "7d", "30d", "90d"];
    const resolvedPeriod = validPeriods.includes(period ?? "") ? (period as "today" | "7d" | "30d" | "90d") : "7d";
    return this.getStorefrontFunnel.execute(merchantId, resolvedPeriod);
  }

  @Get("funnel/:merchantId/sessions")
  async getFunnelSessions(@Param("merchantId") merchantId: string) {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
    const sessions = await this.prisma.checkoutSession.findMany({
      where: { merchantId, updatedAt: { gte: thirtyMinAgo }, NOT: { sessionId: { startsWith: "chk_" } } },
      include: { events: { select: { eventName: true }, orderBy: { occurredAt: "desc" } } },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
    return {
      sessions: sessions.map((s: any) => ({
        sessionId: s.sessionId,
        buyerPhone: "",
        buyerEmail: "",
        buyerName: "",
        stage: resolveStage(s.events.map((e: any) => e.eventName)),
        lastActivityAt: s.updatedAt.toISOString(),
        abandonmentScore: s.abandonmentScore ?? 0,
      })),
      total: sessions.length,
      status: "active",
    };
  }

  @Get("cart/:cartId")
  async getCart(
    @Param("cartId") cartId: string,
    @Query("merchantId") merchantId: string
  ) {
    if (!merchantId) throw new NotFoundException("merchantId query param required");
    const cart = await this.cartRepo.getOrCreate(merchantId, cartId);
    return {
      cartId: cart.sessionId,
      items: cart.items.map((i) => ({
        variantId: i.variantId,
        productName: i.name,
        quantity: i.quantity,
        price: i.unitPriceCents / 100,
        subtotal: (i.unitPriceCents * i.quantity) / 100,
        imageUrl: i.imageUrl ?? undefined,
      })),
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
    @Body() body: { quantity: number }
  ) {
    if (!merchantId) throw new BadRequestException("merchantId query param required");
    if (body.quantity == null || !Number.isInteger(body.quantity) || body.quantity < 0 || body.quantity > 99) {
      throw new BadRequestException("quantity must be an integer between 0 and 99");
    }
    const cart = await this.cartRepo.updateItemQuantity(merchantId, cartId, variantId, body.quantity);
    return {
      cartId: cart.sessionId,
      items: cart.items.map((i) => ({
        variantId: i.variantId,
        productName: i.name,
        quantity: i.quantity,
        price: i.unitPriceCents / 100,
        subtotal: (i.unitPriceCents * i.quantity) / 100,
        imageUrl: i.imageUrl ?? undefined,
      })),
      itemCount: cart.items.reduce((sum, i) => sum + i.quantity, 0),
      discount: cart.discount ? cart.discount / 100 : 0,
      total: cart.total / 100,
    };
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
  async handleListBudgetRequests(@Query("merchantId") merchantId: string) {
    if (!merchantId) throw new NotFoundException("merchantId_required");
    return this.listBudgetRequests.execute(merchantId);
  }

  @Post("budget-requests/:id/status")
  async handleUpdateBudgetStatus(
    @Param("id") id: string,
    @Body() body: { status: "approved" | "rejected" | "responded" }
  ) {
    return this.updateBudgetStatus.execute(id, body.status);
  }
}

function resolveStage(eventNames: string[]): "data_collection" | "shipping" | "payment" | "completed" {
  if (eventNames.includes("order_completed")) return "completed";
  if (eventNames.includes("payment_method_selected")) return "payment";
  if (eventNames.includes("cart_viewed")) return "shipping";
  if (eventNames.includes("product_viewed")) return "data_collection";
  return "data_collection";
}
