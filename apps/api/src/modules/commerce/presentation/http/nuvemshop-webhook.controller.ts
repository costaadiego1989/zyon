import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Param,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
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
 * Nuvemshop webhooks do NOT provide HMAC signatures natively.
 * Defense layers:
 *   1. HTTPS-only transport (operator-configured).
 *   2. The inbound `store_id` must equal the merchant's persisted `storeId`.
 *   3. If the merchant has a `webhookSecret` configured, we validate the
 *      `X-Linkedstore-HMAC-SHA256` header (custom HMAC over raw body).
 *      This is the same pattern Nuvemshop uses for "Linked Store" apps.
 *   4. Rate-limit: per-merchant request frequency is bounded externally (gateway).
 *
 * Spec: https://tiendanube.github.io/api-documentation/resources/webhook
 */
@Controller()
export class NuvemshopWebhookController {
  private readonly logger = new Logger(NuvemshopWebhookController.name);

  /** Per-store sliding window counters: storeId -> { count, windowStart } */
  private readonly rateMap = new Map<string, { count: number; windowStart: number }>();
  private static readonly RATE_LIMIT_WINDOW_MS = 60_000;
  private static readonly RATE_LIMIT_MAX_PER_WINDOW = 120;

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
    @Headers("x-linkedstore-hmac-sha256") hmacHeader: string | undefined,
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

    // Rate-limit per store_id to mitigate replay/flood attacks
    if (!this.checkRateLimit(storeId)) {
      this.logger.warn(`nuvemshop_webhook_rate_limited: store=${storeId}`);
      throw new UnauthorizedException("nuvemshop_webhook_rate_limited");
    }

    const credentials = await this.connections.getCredentials(merchant);
    if (!credentials || credentials.provider !== "nuvemshop") {
      throw new UnauthorizedException("nuvemshop_webhook_merchant_not_found");
    }

    if (credentials.storeId.trim() !== storeId) {
      throw new UnauthorizedException("nuvemshop_webhook_store_id_mismatch");
    }

    // HMAC signature validation when merchant has a webhook secret configured
    if (credentials.webhookSecret) {
      if (!hmacHeader) {
        this.logger.warn(`nuvemshop_webhook_hmac_missing: merchant=${merchant}`);
        throw new UnauthorizedException("nuvemshop_webhook_hmac_missing");
      }
      const rawBody = JSON.stringify(body);
      if (!this.verifyHmac(rawBody, credentials.webhookSecret, hmacHeader)) {
        this.logger.warn(`nuvemshop_webhook_hmac_invalid: merchant=${merchant}`);
        throw new UnauthorizedException("nuvemshop_webhook_hmac_invalid");
      }
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

  /**
   * Verify HMAC-SHA256 signature using timing-safe comparison.
   * Expected header value: hex-encoded HMAC of the raw JSON body.
   */
  private verifyHmac(rawBody: string, secret: string, headerValue: string): boolean {
    try {
      const computed = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
      const expected = Buffer.from(computed, "utf8");
      const received = Buffer.from(headerValue.trim(), "utf8");
      if (expected.length !== received.length) return false;
      return timingSafeEqual(expected, received);
    } catch {
      return false;
    }
  }

  /**
   * Simple in-memory sliding window rate-limiter per store_id.
   * Prevents replay/flood attacks without external dependencies.
   */
  private checkRateLimit(storeId: string): boolean {
    const now = Date.now();
    const entry = this.rateMap.get(storeId);
    if (!entry || now - entry.windowStart > NuvemshopWebhookController.RATE_LIMIT_WINDOW_MS) {
      this.rateMap.set(storeId, { count: 1, windowStart: now });
      return true;
    }
    entry.count++;
    return entry.count <= NuvemshopWebhookController.RATE_LIMIT_MAX_PER_WINDOW;
  }
}

/** Nuvemshop webhook payload — only the routing fields are required. */
export type NuvemshopWebhookPayload = {
  store_id?: string | number;
  event?: string;
  id?: string | number;
  [k: string]: unknown;
};