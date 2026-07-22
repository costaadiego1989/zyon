import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Logger,
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
import {
  COMMERCE_PAID_WEBHOOK_DEDUP,
  type CommercePaidWebhookDedupPort,
} from "../../domain/ports/commerce-paid-webhook-dedup.port.js";
import { createCommerceEventEnvelope } from "../../domain/events/commerce-domain-event.js";
import { TenantCommerceAdapterFactory } from "../../infrastructure/tenant-commerce-adapter.factory.js";

export type ShopifyWebhookResult =
  | { outcome: "ignored"; reason: string }
  | { outcome: "processed"; topic: string };

/**
 * Receives inbound webhooks from Shopify.
 *
 * Signature verification: Shopify sends `X-Shopify-Hmac-SHA256` which is the
 * Base64-encoded HMAC-SHA256 of the raw request body using the Shopify app's
 * shared `client_secret` (configured per-merchant via the dedicated
 * `webhookSecret` field; falls back to `adminAccessToken` only for legacy
 * connections).
 *
 * Spec: https://shopify.dev/docs/apps/webhooks/configuration/https
 */
@Controller()
export class ShopifyWebhookController {
  private readonly logger = new Logger(ShopifyWebhookController.name);

  constructor(
    @Inject(COMMERCE_CONNECTION_PORT)
    private readonly connections: CommerceConnectionPort,
    private readonly adapterFactory: TenantCommerceAdapterFactory,
    @Inject(COMMERCE_PAID_WEBHOOK_DEDUP)
    private readonly paidDedup: CommercePaidWebhookDedupPort,
  ) {}

  @Post("webhooks/shopify/:merchantId")
  @HttpCode(200)
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers("x-shopify-hmac-sha256") signature: string | undefined,
    @Headers("x-shopify-topic") topic: string | undefined,
    @Headers("x-shopify-shop-domain") shopDomain: string | undefined,
    @Headers("x-shopify-webhook-id") webhookId: string | undefined,
  ): Promise<ShopifyWebhookResult> {
    const merchantId = (req.params as Record<string, string>).merchantId?.trim();
    if (!merchantId) {
      throw new BadRequestException("shopify_webhook_merchant_id_missing");
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new BadRequestException("shopify_webhook_raw_body_missing");
    }

    const credentials = await this.connections.getCredentials(merchantId);
    if (!credentials || credentials.provider !== "shopify") {
      throw new UnauthorizedException("shopify_webhook_merchant_not_found");
    }

    if (
      shopDomain &&
      credentials.shopDomain.trim().toLowerCase() !==
        shopDomain.trim().toLowerCase()
    ) {
      throw new UnauthorizedException("shopify_webhook_shop_domain_mismatch");
    }

    const secret = credentials.webhookSecret ?? credentials.adminAccessToken;
    if (!secret) {
      throw new UnauthorizedException("shopify_webhook_secret_not_configured");
    }

    this.verifySignature(rawBody, signature, secret);

    if (!topic) {
      return { outcome: "ignored", reason: "missing_topic" };
    }

    switch (topic) {
      case "orders/create":
      case "orders/updated":
      case "orders/cancelled":
        this.adapterFactory.invalidateAdapter(merchantId);
        return { outcome: "processed", topic };

      case "orders/paid":
        this.adapterFactory.invalidateAdapter(merchantId);
        await this.dispatchPaidEvent({
          merchantId,
          payload: parseJsonObject(rawBody),
          webhookId,
        });
        return { outcome: "processed", topic };

      case "products/create":
      case "products/update":
      case "products/delete":
        this.adapterFactory.invalidateAdapter(merchantId);
        return { outcome: "processed", topic };

      case "app/uninstalled":
        try {
          await this.connections.disconnect(merchantId);
        } catch (error) {
          this.logger.warn(
            `app/uninstalled: disconnect failed for ${merchantId} (webhook_id=${webhookId ?? "unknown"}): ${(error as Error).message}`,
          );
        }
        this.adapterFactory.invalidateAdapter(merchantId);
        return { outcome: "processed", topic };

      default:
        return { outcome: "ignored", reason: `unhandled_topic:${topic}` };
    }
  }

  private async dispatchPaidEvent(input: {
    merchantId: string;
    payload: Record<string, unknown>;
    webhookId: string | undefined;
  }): Promise<void> {
    const commerceOrderId = String(
      input.payload.id ?? input.payload.admin_graphql_api_id ?? "",
    ).trim();
    if (!commerceOrderId) return;

    const paymentReference = `shopify:${input.webhookId ?? commerceOrderId}`;
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
        provider: "shopify",
      },
      causationId: "shopify.orders/paid",
    });
    await this.paidDedup.markProcessed(
      input.merchantId,
      paymentReference,
      commerceOrderId,
      event,
    );
  }

  private verifySignature(
    rawBody: Buffer,
    signature: string | undefined,
    secret: string,
  ): void {
    if (!signature) {
      throw new UnauthorizedException("shopify_webhook_signature_missing");
    }

    const expected = createHmac("sha256", secret)
      .update(rawBody)
      .digest("base64");

    const sigBuffer = Buffer.from(signature, "base64");
    const expectedBuffer = Buffer.from(expected, "base64");

    if (sigBuffer.length !== expectedBuffer.length) {
      throw new UnauthorizedException("shopify_webhook_signature_invalid");
    }

    if (!timingSafeEqual(sigBuffer, expectedBuffer)) {
      throw new UnauthorizedException("shopify_webhook_signature_invalid");
    }
  }
}

function parseJsonObject(rawBody: Buffer): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawBody.toString("utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}