import { BadRequestException, Body, Controller, Headers, HttpCode, Inject, Logger, Param, Post, RawBodyRequest, Req, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import type { PrismaClient } from "@prisma/client";
import type { Request } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { ErpSyncService } from "../../application/services/erp-sync.service.js";

type BlingWebhookPayload = {
  eventId?: unknown;
  event?: unknown;
  companyId?: unknown;
};

function validBlingSignature(rawBody: Buffer | undefined, signature: string | undefined, secret: string): boolean {
  if (!rawBody || !signature?.startsWith("sha256=")) return false;
  const actual = signature.slice("sha256=".length).toLowerCase();
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  if (!/^[a-f0-9]+$/.test(actual) || actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

/**
 * Receives webhook notifications from marketplace providers (ML, Shopee, TikTok Shop).
 * ML sends: { resource, user_id, topic, application_id, attempts, sent, received }
 */
@ApiTags("Inventory - Marketplace Webhooks")
@Controller("inventory/erp/webhook")
export class MarketplaceWebhookController {
  private readonly logger = new Logger(MarketplaceWebhookController.name);
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly erpSync: ErpSyncService,
  ) {}

  /**
   * POST /inventory/erp/webhook/:provider
   * Mercado Livre sends notifications here when items/orders/shipments change.
   */
  @Post(":provider")
  @HttpCode(200)
  @ApiOperation({ summary: "Receive marketplace webhook notification" })
  async handleWebhook(
    @Param("provider") provider: string,
    @Body() body: any,
    @Req() request: RawBodyRequest<Request>,
    @Headers("x-bling-signature-256") blingSignature?: string,
  ) {
    const providerLower = provider.toLowerCase();
    if (providerLower === "bling") {
      return this.handleBlingWebhook(request.rawBody, blingSignature, body as BlingWebhookPayload);
    }
    this.logger.log("marketplace.webhook.received", { provider: providerLower, topic: body.topic, resource: body.resource });

    try {
      switch (providerLower) {
        case "mercadolivre":
          await this.handleMercadoLivre(body);
          break;
        case "shopee":
          await this.handleShopee(body);
          break;
        case "tiktokshop":
          await this.handleTikTokShop(body);
          break;
        default:
          this.logger.warn("marketplace.webhook.unknown_provider", { provider: providerLower });
      }
    } catch (err) {
      this.logger.error("marketplace.webhook.processing_failed", {
        provider: providerLower,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Always return 200 to acknowledge (avoid retries)
    return { received: true };
  }

  private async handleBlingWebhook(rawBody: Buffer | undefined, signature: string | undefined, body: BlingWebhookPayload) {
    const secret = process.env.BLING_CLIENT_SECRET?.trim();
    if (!secret) throw new ServiceUnavailableException("bling_webhook_not_configured");
    if (!validBlingSignature(rawBody, signature, secret)) throw new UnauthorizedException("bling_webhook_invalid_signature");

    const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
    const companyId = typeof body.companyId === "string" ? body.companyId.trim() : "";
    const resource = typeof body.event === "string" ? body.event.split(".", 1)[0] : "";
    if (!eventId || !companyId || !resource) throw new BadRequestException("bling_webhook_invalid_payload");
    if (!new Set(["product", "stock", "virtual_stock"]).has(resource)) {
      return { received: true, ignored: true };
    }

    const route = await this.prisma.erpWebhookRoute.findUnique({
      where: { provider_externalAccountId: { provider: "bling", externalAccountId: companyId } },
      select: { merchantId: true, connectionId: true },
    });
    if (!route) throw new BadRequestException("bling_webhook_connection_not_found");

    const job = await this.erpSync.enqueueWebhookFull(route.merchantId, route.connectionId, eventId);
    this.logger.log("bling.webhook.queued", { connectionId: route.connectionId, eventId, resource, jobId: job.id });
    return { received: true };
  }

  private async handleMercadoLivre(body: any): Promise<void> {
    const { topic, resource, user_id } = body;

    switch (topic) {
      case "orders_v2":
        // New order on ML → fetch order details → decrement stock
        this.logger.log("ml.webhook.order", { resource, user_id });
        // TODO: Fetch order from ML API, match items by SKU, decrement InventoryItem
        break;

      case "items":
        // Item changed on ML → sync stock/price if needed
        this.logger.log("ml.webhook.item_changed", { resource, user_id });
        break;

      case "shipments":
        // Shipment status changed → if delivered, trigger post-sale
        this.logger.log("ml.webhook.shipment", { resource, user_id });
        // TODO: If status=delivered, emit order.delivered event for post-sale
        break;

      case "messages":
        this.logger.log("ml.webhook.message", { resource, user_id });
        break;

      case "post_purchase":
        // Review or claim on ML
        this.logger.log("ml.webhook.post_purchase", { resource, user_id });
        break;

      default:
        this.logger.debug("ml.webhook.unhandled_topic", { topic, resource });
    }
  }

  private async handleShopee(body: any): Promise<void> {
    const { code: eventCode, shop_id, data } = body;
    this.logger.log("shopee.webhook.event", { eventCode, shop_id });

    switch (eventCode) {
      case 3: // Order status update
        this.logger.log("shopee.webhook.order_status", { shop_id, data });
        break;
      case 5: // Item stock changed
        this.logger.log("shopee.webhook.item_stock", { shop_id, data });
        break;
      default:
        this.logger.debug("shopee.webhook.unhandled", { eventCode });
    }
  }

  private async handleTikTokShop(body: any): Promise<void> {
    const { type, shop_id, data } = body;
    this.logger.log("tiktok.webhook.event", { type, shop_id });

    switch (type) {
      case "ORDER_STATUS_CHANGE":
        this.logger.log("tiktok.webhook.order_status", { shop_id, data });
        break;
      case "PRODUCT_STATUS_CHANGE":
        this.logger.log("tiktok.webhook.product_status", { shop_id, data });
        break;
      default:
        this.logger.debug("tiktok.webhook.unhandled", { type });
    }
  }
}
