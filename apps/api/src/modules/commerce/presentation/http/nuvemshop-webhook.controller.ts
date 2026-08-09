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

export type NuvemshopWebhookResult =
  | { outcome: "ignored"; reason: string }
  | { outcome: "processed"; event: string };

/**
 * Receives inbound webhooks from Nuvemshop (Tiendanube).
 *
 * Nuvemshop webhooks do NOT use HMAC signatures. The expected defense is:
 *   1. HTTPS-only transport (operator-configured).
 *   2. The inbound `store_id` must equal the merchant's persisted `storeId`.
 *
 * Spec: https://tiendanube.github.io/api-documentation/resources/webhook
 */
@Controller()
export class NuvemshopWebhookController {
  private readonly logger = new Logger(NuvemshopWebhookController.name);

  constructor(
    @Inject(COMMERCE_CONNECTION_PORT)
    private readonly connections: CommerceConnectionPort,
    @Inject(COMMERCE_ADAPTER_CACHE_PORT)
    private readonly adapterFactory: CommerceAdapterCachePort,
    @Inject(COMMERCE_PAID_WEBHOOK_DEDUP)
    private readonly paidDedup: CommercePaidWebhookDedupPort,
  ) {}

  @Post("webhooks/nuvemshop/:merchantId")
  @HttpCode(200)
  async handleWebhook(
    @Param("merchantId") merchantId: string | undefined,
    @Body() body: NuvemshopWebhookPayload,
  ): Promise<NuvemshopWebhookResult> {
    const merchant = (merchantId ?? "").trim();
    if (!merchant) {
      throw new BadRequestException("nuvemshop_webhook_merchant_id_missing");
    }
    if (!body || typeof body !== "object") {
      throw new BadRequestException("nuvemshop_webhook_body_invalid");
    }

    const storeId = String(body.store_id ?? "").trim();
    const event = String(body.event ?? "").trim();
    if (!storeId || !event) {
      throw new BadRequestException("nuvemshop_webhook_payload_invalid");
    }

    const credentials = await this.connections.getCredentials(merchant);
    if (!credentials || credentials.provider !== "nuvemshop") {
      throw new UnauthorizedException("nuvemshop_webhook_merchant_not_found");
    }

    if (credentials.storeId.trim() !== storeId) {
      throw new UnauthorizedException("nuvemshop_webhook_store_id_mismatch");
    }

    switch (event) {
      case "order/created":
      case "order/updated":
      case "order/cancelled":
        this.adapterFactory.invalidateAdapter(merchant);
        return { outcome: "processed", event };

      case "order/paid":
        this.adapterFactory.invalidateAdapter(merchant);
        await this.dispatchPaidEvent({ merchantId: merchant, payload: body });
        return { outcome: "processed", event };

      case "product/created":
      case "product/updated":
      case "product/deleted":
        this.adapterFactory.invalidateAdapter(merchant);
        return { outcome: "processed", event };

      default:
        this.logger.warn(
          `nuvemshop_webhook_unhandled_event: merchant=${merchant} event=${event}`,
        );
        return { outcome: "ignored", reason: `unhandled_event:${event}` };
    }
  }

  private async dispatchPaidEvent(input: {
    merchantId: string;
    payload: NuvemshopWebhookPayload;
  }): Promise<void> {
    const commerceOrderId = String(input.payload.id ?? "").trim();
    if (!commerceOrderId) return;

    const paymentReference = `nuvemshop:${commerceOrderId}:order/paid`;
    const reserved = await this.paidDedup.tryReserve(
      input.merchantId,
      paymentReference,
    );
    if (!reserved) return;

    const event = createCommerceEventEnvelope({
      eventType: "commerce.order.paid",
      merchantId: input.merchantId,
      payload: {
        commerce_order_id: commerceOrderId,
        payment_reference: paymentReference,
        provider: "nuvemshop",
      },
      causationId: "nuvemshop.order/paid",
    });
    await this.paidDedup.markProcessed(
      input.merchantId,
      paymentReference,
      commerceOrderId,
      event,
    );
  }
}

/** Nuvemshop webhook payload — only the routing fields are required. */
export type NuvemshopWebhookPayload = {
  store_id?: string | number;
  event?: string;
  id?: string | number;
  [k: string]: unknown;
};