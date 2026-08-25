import { Controller, Post, Body, Param, Logger, HttpCode } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";

/**
 * Receives webhook notifications from marketplace providers (ML, Shopee, TikTok Shop).
 * ML sends: { resource, user_id, topic, application_id, attempts, sent, received }
 */
@ApiTags("Inventory - Marketplace Webhooks")
@Controller("inventory/erp/webhook")
export class MarketplaceWebhookController {
  private readonly logger = new Logger(MarketplaceWebhookController.name);

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
  ) {
    const providerLower = provider.toLowerCase();
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
