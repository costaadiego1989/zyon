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
    switch (topic) {
      case "order.created":
      case "order.updated":
        // Invalidate the adapter cache so any cached state is refreshed.
        this.adapterFactory.invalidateAdapter(merchantId);
        return { outcome: "processed", topic };

      case "product.updated":
      case "product.created":
      case "product.deleted":
        // Invalidate adapter cache to refresh catalog data on next request.
        this.adapterFactory.invalidateAdapter(merchantId);
        return { outcome: "processed", topic };

      default:
        return { outcome: "ignored", reason: `unhandled_topic:${topic}` };
    }
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
