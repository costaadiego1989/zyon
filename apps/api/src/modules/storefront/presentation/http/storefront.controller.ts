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

  @Get("funnel/:merchantId/sessions")
  async getFunnelSessions(@Param("merchantId") merchantId: string) {
    // Reuse checkout funnel sessions — same table, filtered by merchantId + last 30 min
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
      })),
      itemCount: cart.items.reduce((sum, i) => sum + i.quantity, 0),
      discount: cart.discount ? cart.discount / 100 : 0,
      total: cart.total / 100,
    };
  }

  @Post("budget-requests")
  async createBudgetRequest(@Body() body: {
    merchant_id: string;
    customer_name: string;
    customer_email: string;
    customer_phone: string;
    items: Array<{ variantId: string; productName: string; quantity: number; price: number }>;
    total: number;
    note?: string;
  }) {
    if (!body.merchant_id || !body.customer_name || !body.customer_email || !body.customer_phone) {
      throw new NotFoundException("missing_required_fields");
    }
    if (!body.items?.length) throw new NotFoundException("items_required");

    const budget = await this.prisma.budgetRequest.create({
      data: {
        merchantId: body.merchant_id,
        customerName: body.customer_name,
        customerEmail: body.customer_email,
        customerPhone: body.customer_phone.replace(/\D/g, ""),
        items: body.items as any,
        subtotal: body.total,
        total: body.total,
        note: body.note ?? null,
        status: "pending",
      },
    });

    // Notify merchant (non-blocking)
    this.notifyMerchantBudget(body.merchant_id, budget.id, body).catch(() => {});

    return { id: budget.id, status: budget.status, createdAt: budget.createdAt.toISOString() };
  }

  @Get("budget-requests")
  async listBudgetRequests(@Query("merchantId") merchantId: string) {
    if (!merchantId) throw new NotFoundException("merchantId_required");
    const requests = await this.prisma.budgetRequest.findMany({
      where: { merchantId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return requests.map((r) => ({
      id: r.id,
      customerName: r.customerName,
      customerEmail: r.customerEmail,
      customerPhone: r.customerPhone,
      items: r.items,
      total: r.total,
      note: r.note,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  private async notifyMerchantBudget(merchantId: string, budgetId: string, body: any) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { name: true, budgetEmail: true, budgetWhatsapp: true, storeSettings: true },
    });
    if (!merchant) return;

    const email = merchant.budgetEmail ?? (merchant.storeSettings as any)?.company?.email;
    const phone = merchant.budgetWhatsapp ?? (merchant.storeSettings as any)?.company?.phone;
    const itemsText = body.items.map((i: any) => `• ${i.productName} x${i.quantity} — R$ ${i.price.toFixed(2)}`).join("\n");
    const totalText = `R$ ${body.total.toFixed(2)}`;

    // WhatsApp notification (wa.me link logged for now)
    if (phone) {
      const waText = encodeURIComponent(
        `Novo orçamento de ${body.customer_name}!\n${body.items.length} items — ${totalText}\nEmail: ${body.customer_email}\nTel: ${body.customer_phone}`
      );
      const waLink = `https://wa.me/${phone.replace(/\D/g, "")}?text=${waText}`;
      console.log(`[Budget] WhatsApp link: ${waLink}`);
    }

    // Email notification (log for now — integrate nodemailer later)
    if (email) {
      console.log(`[Budget] Email to ${email}:`);
      console.log(`  Subject: Novo orçamento — ${body.customer_name}`);
      console.log(`  Items:\n${itemsText}`);
      console.log(`  Total: ${totalText}`);
      console.log(`  Cliente: ${body.customer_name} | ${body.customer_email} | ${body.customer_phone}`);
    }
  }
}

function resolveStage(eventNames: string[]): "data_collection" | "shipping" | "payment" | "completed" {
  if (eventNames.includes("order_completed")) return "completed";
  if (eventNames.includes("payment_method_selected")) return "payment";
  if (eventNames.includes("cart_viewed")) return "shipping";
  if (eventNames.includes("product_viewed")) return "data_collection";
  return "data_collection";
}
