import { Body, Controller, Get, Inject, NotFoundException, Param, Post, Query, Res } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { NonProductionRoute } from "../../../../shared/http/non-production-route.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { StartStoreConversationUseCase } from "../../application/use-cases/start-store-conversation.use-case.js";
import { SendStoreMessageUseCase } from "../../application/use-cases/send-store-message.use-case.js";
import { GetConversationHistoryUseCase } from "../../application/use-cases/get-conversation-history.use-case.js";
import { GetStoreConfigUseCase } from "../../application/use-cases/get-store-config.use-case.js";
import { GetStorefrontFunnelUseCase } from "../../application/use-cases/get-storefront-funnel.use-case.js";
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

  @Get("funnel/:merchantId")
  async getFunnel(
    @Param("merchantId") merchantId: string,
    @Query("period") period?: string
  ) {
    const validPeriods = ["today", "7d", "30d", "90d"];
    const resolvedPeriod = validPeriods.includes(period ?? "") ? (period as "today" | "7d" | "30d" | "90d") : "7d";
    return this.getStorefrontFunnel.execute(merchantId, resolvedPeriod);
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
      })),
      itemCount: cart.items.reduce((sum, i) => sum + i.quantity, 0),
      discount: cart.discount ? cart.discount / 100 : 0,
      total: cart.total / 100,
    };
  }
}
