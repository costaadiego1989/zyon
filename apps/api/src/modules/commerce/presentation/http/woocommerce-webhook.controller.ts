import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import {
  COMMERCE_CONNECTION_PORT,
  type CommerceConnectionPort,
} from "../../domain/ports/commerce-connection.port.js";
import { COMMERCE_ADAPTER_CACHE_PORT, type CommerceAdapterCachePort } from "../../domain/ports/commerce-adapter-cache.port.js";
import {
  COMMERCE_PAID_WEBHOOK_DEDUP,
  type CommercePaidWebhookDedupPort,
} from "../../domain/ports/commerce-paid-webhook-dedup.port.js";
import { createCommerceEventEnvelope } from "../../domain/events/commerce-domain-event.js";

export type WooCommerceWebhookResult =
  | { outcome: "ignored"; reason: string }
  | { outcome: "processed"; topic: string };

/**
 * Receives inbound webhooks from WooCommerce stores.
 *
 * Signature verification: WooCommerce sends `X-WC-Webhook-Signature` which is
 * the Base64-encoded HMAC-SHA256 of the raw request body using the WooCommerce
 * webhook secret configured per-merchant (falls back to `consumerSecret` for
 * legacy connections).
 */
@Controller()
export class WooCommerceWebhookController {
  constructor(
    @Inject(COMMERCE_CONNECTION_PORT)
    private readonly connections: CommerceConnectionPort,
    @Inject(COMMERCE_ADAPTER_CACHE_PORT)
    private readonly adapterFactory: CommerceAdapterCachePort,
    @Inject(COMMERCE_PAID_WEBHOOK_DEDUP)
    private readonly paidDedup: CommercePaidWebhookDedupPort,
  ) {}

  @Post("webhooks/woocommerce/:merchantId")
  @HttpCode(200)
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers("x-wc-webhook-signature") signature: string | undefined,
    @Headers("x-wc-webhook-topic") topic: string | undefined,
    @Headers("x-wc-webhook-source") source: string | undefined,
  ): Promise<WooCommerceWebhookResult> {
    const merchantId = (req.params as Record<string, string>).merchantId?.trim();
    if (!merchantId) {
      throw new BadRequestException("woocommerce_webhook_merchant_id_missing");
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new BadRequestException("woocommerce_webhook_raw_body_missing");
    }

    // Verify HMAC-SHA256 signature using the merchant's consumer secret.
    const credentials = await this.connections.getCredentials(merchantId);
    if (!credentials || credentials.provider !== "woocommerce") {
      throw new UnauthorizedException("woocommerce_webhook_merchant_not_found");
    }

    const secret = credentials.webhookSecret ?? credentials.consumerSecret;
    if (!secret) {
      throw new UnauthorizedException("woocommerce_webhook_secret_not_configured");
    }

    this.verifySignature(rawBody, signature, secret);

    if (!topic) {
      return { outcome: "ignored", reason: "missing_topic" };
    }

    // Handle known topics
    const body = JSON.parse(rawBody.toString("utf-8"));

    switch (topic) {
      case "order.created":
      case "order.updated": {
        this.adapterFactory.invalidateAdapter(merchantId);
        const status = body?.status as string | undefined;
        if (status === "processing" || status === "completed") {
          await this.dispatchPaidEvent({ merchantId, body, topic });
        }
        return { outcome: "processed", topic };
      }

      case "product.updated":
      case "product.created":
      case "product.deleted":
        this.adapterFactory.invalidateAdapter(merchantId);
        return { outcome: "processed", topic };

      default:
        return { outcome: "ignored", reason: `unhandled_topic:${topic}` };
    }
  }

  private async dispatchPaidEvent(input: {
    merchantId: string;
    body: Record<string, unknown>;
    topic: string;
  }): Promise<void> {
    const commerceOrderId = String(input.body.id ?? "");
    if (!commerceOrderId) return;

    const paymentReference = `woocommerce:${commerceOrderId}:${input.topic}`;
    const reserved = await this.paidDedup.tryReserve(input.merchantId, paymentReference);
    if (!reserved) return;

    const event = createCommerceEventEnvelope({
      eventType: "commerce.order.paid",
      merchantId: input.merchantId,
      payload: {
        commerce_order_id: commerceOrderId,
        payment_reference: paymentReference,
        provider: "woocommerce",
      },
      causationId: `woocommerce.${input.topic}`,
    });
    await this.paidDedup.markProcessed(input.merchantId, paymentReference, commerceOrderId, event);
  }

  private verifySignature(
    rawBody: Buffer,
    signature: string | undefined,
    secret: string,
  ): void {
    if (!signature) {
      throw new UnauthorizedException("woocommerce_webhook_signature_missing");
    }

    const expected = createHmac("sha256", secret)
      .update(rawBody)
      .digest("base64");

    const sigBuffer = Buffer.from(signature, "base64");
    const expectedBuffer = Buffer.from(expected, "base64");

    if (sigBuffer.length !== expectedBuffer.length) {
      throw new UnauthorizedException("woocommerce_webhook_signature_invalid");
    }

    if (!timingSafeEqual(sigBuffer, expectedBuffer)) {
      throw new UnauthorizedException("woocommerce_webhook_signature_invalid");
    }
  }
}
