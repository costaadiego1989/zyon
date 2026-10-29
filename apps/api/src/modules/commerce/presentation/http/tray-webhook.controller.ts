import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Inject,
  Logger,
  Param,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import {
  COMMERCE_CONNECTION_PORT,
  type CommerceConnectionPort,
} from "../../domain/ports/commerce-connection.port.js";
import {
  COMMERCE_PAID_WEBHOOK_DEDUP,
  type CommercePaidWebhookDedupPort,
} from "../../domain/ports/commerce-paid-webhook-dedup.port.js";
import { createCommerceEventEnvelope } from "../../domain/events/commerce-domain-event.js";
import { COMMERCE_ADAPTER_CACHE_PORT, type CommerceAdapterCachePort } from "../../domain/ports/commerce-adapter-cache.port.js";

export type TrayWebhookResult =
  | { outcome: "ignored"; reason: string }
  | { outcome: "processed"; scope: string; action: string };

/**
 * Receives inbound webhooks from Tray Commerce.
 *
 * Tray webhooks do NOT use HMAC signatures. The expected defense is:
 *   1. HTTPS-only transport (operator-configured).
 *   2. The inbound `api_address` must match the merchant's persisted API address.
 *   3. Webhook must be activated in Tray admin via support ticket.
 *
 * Spec: https://developers.tray.com.br (Webhook / Notification System section)
 *
 * Webhook is sent as x-www-form-urlencoded POST:
 *   - seller_id: numeric store identifier
 *   - scope_id: resource ID
 *   - scope_name: "order", "product", "variant", "customer", etc.
 *   - act: "insert", "update", "delete"
 *   - app_code: app identifier
 */
@Controller()
export class TrayWebhookController {
  private readonly logger = new Logger(TrayWebhookController.name);

  constructor(
    @Inject(COMMERCE_CONNECTION_PORT)
    private readonly connections: CommerceConnectionPort,
    @Inject(COMMERCE_ADAPTER_CACHE_PORT)
    private readonly adapterFactory: CommerceAdapterCachePort,
    @Inject(COMMERCE_PAID_WEBHOOK_DEDUP)
    private readonly paidDedup: CommercePaidWebhookDedupPort,
  ) {}

  @Post("webhooks/tray/:merchantId")
  @HttpCode(200)
  async handleWebhook(
    @Param("merchantId") merchantId: string | undefined,
    @Body() body: TrayWebhookPayload,
  ): Promise<TrayWebhookResult> {
    const merchant = (merchantId ?? "").trim();
    if (!merchant) {
      throw new BadRequestException("tray_webhook_merchant_id_missing");
    }
    if (!body || typeof body !== "object") {
      throw new BadRequestException("tray_webhook_body_invalid");
    }

    const scope = String(body.scope_name ?? "").trim();
    const action = String(body.act ?? "").trim();
    const scopeId = String(body.scope_id ?? "").trim();

    if (!scope || !action || !scopeId) {
      throw new BadRequestException("tray_webhook_payload_invalid");
    }

    const credentials = await this.connections.getCredentials(merchant);
    if (!credentials || credentials.provider !== "tray") {
      throw new UnauthorizedException("tray_webhook_merchant_not_found");
    }

    switch (scope) {
      case "order":
        this.adapterFactory.invalidateAdapter(merchant);
        if (action === "update") {
          await this.handleOrderUpdate({
            merchantId: merchant,
            scopeId,
            payload: body,
          });
        }
        return { outcome: "processed", scope, action };

      case "product":
      case "product_price":
      case "product_stock":
        this.adapterFactory.invalidateAdapter(merchant);
        return { outcome: "processed", scope, action };

      case "variant":
      case "variant_price":
      case "variant_stock":
        this.adapterFactory.invalidateAdapter(merchant);
        return { outcome: "processed", scope, action };

      case "customer":
      case "store_config":
        this.adapterFactory.invalidateAdapter(merchant);
        return { outcome: "processed", scope, action };

      default:
        this.logger.warn(
          `tray_webhook_unhandled_scope: merchant=${merchant} scope=${scope} action=${action}`,
        );
        return { outcome: "ignored", reason: `unhandled_scope:${scope}:${action}` };
    }
  }

  private async handleOrderUpdate(input: {
    merchantId: string;
    scopeId: string;
    payload: TrayWebhookPayload;
  }): Promise<void> {
    const status = String(input.payload.status ?? "").trim().toLowerCase();

    // Only dispatch "paid" domain event when order status transitions to "paid" or "invoiced"
    // (Tray uses "invoiced" to indicate payment received)
    if (status !== "paid" && status !== "invoiced") {
      return;
    }

    const paymentReference = `tray:${input.scopeId}:order.update`;
    const reserved = await this.paidDedup.tryReserve(
      input.merchantId,
      paymentReference,
    );
    if (!reserved) return;

    const event = createCommerceEventEnvelope({
      eventType: "commerce.order.paid",
      merchantId: input.merchantId,
      payload: {
        commerce_order_id: input.scopeId,
        payment_reference: paymentReference,
        provider: "tray",
      },
      causationId: "tray.order.update",
    });
    await this.paidDedup.markProcessed(
      input.merchantId,
      paymentReference,
      input.scopeId,
      event,
    );
  }
}

/**
 * Tray webhook payload — only the routing fields are required.
 * Tray sends form-encoded data; NestJS auto-parses to object.
 */
export type TrayWebhookPayload = {
  seller_id?: string | number;
  scope_id?: string | number;
  scope_name?: string;
  act?: string;
  app_code?: string;
  status?: string;
  [k: string]: unknown;
};
