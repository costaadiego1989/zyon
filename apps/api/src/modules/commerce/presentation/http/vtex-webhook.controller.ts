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

export type VtexWebhookResult =
  | { outcome: "ignored"; reason: string }
  | { outcome: "processed"; event: string };

/**
 * Receives inbound webhooks from VTEX (Order Hook).
 *
 * VTEX Order Hook does not use HMAC signatures. Defense layers:
 *   1. HTTPS-only transport (operator-configured).
 *   2. The `accountName` in the payload must match the merchant's persisted credentials.
 *   3. Tenant boundary is enforced via merchantId URL param.
 *
 * Spec: https://developers.vtex.com/docs/guides/orders-feed
 */
@Controller()
export class VtexWebhookController {
  private readonly logger = new Logger(VtexWebhookController.name);

  constructor(
    @Inject(COMMERCE_CONNECTION_PORT)
    private readonly connections: CommerceConnectionPort,
    @Inject(COMMERCE_ADAPTER_CACHE_PORT)
    private readonly adapterFactory: CommerceAdapterCachePort,
    @Inject(COMMERCE_PAID_WEBHOOK_DEDUP)
    private readonly paidDedup: CommercePaidWebhookDedupPort,
  ) {}

  @Post("webhooks/vtex/:merchantId")
  @HttpCode(200)
  async handleWebhook(
    @Param("merchantId") merchantId: string | undefined,
    @Body() body: VtexWebhookPayload,
  ): Promise<VtexWebhookResult> {
    const merchant = (merchantId ?? "").trim();
    if (!merchant) {
      throw new BadRequestException("vtex_webhook_merchant_id_missing");
    }
    if (!body || typeof body !== "object") {
      throw new BadRequestException("vtex_webhook_body_invalid");
    }

    const orderId = String(body.orderId ?? "").trim();
    const status = String(body.status ?? "").trim();
    if (!orderId || !status) {
      throw new BadRequestException("vtex_webhook_payload_invalid");
    }

    const credentials = await this.connections.getCredentials(merchant);
    if (!credentials || credentials.provider !== "vtex") {
      throw new UnauthorizedException("vtex_webhook_merchant_not_found");
    }

    // Validate accountName from webhook body matches stored credentials
    const bodyAccountName = String(body.accountName ?? "").trim();
    if (bodyAccountName && bodyAccountName !== credentials.accountName.trim()) {
      throw new UnauthorizedException("vtex_webhook_account_name_mismatch");
    }

    switch (status) {
      case "payment-approved":
      case "invoiced":
        this.adapterFactory.invalidateAdapter(merchant);
        await this.dispatchPaidEvent({ merchantId: merchant, payload: body });
        return { outcome: "processed", event: `order.${status}` };

      case "order-created":
      case "order-completed":
      case "handling":
      case "ready-for-handling":
        this.adapterFactory.invalidateAdapter(merchant);
        return { outcome: "processed", event: `order.${status}` };

      case "canceled":
      case "cancelled":
        this.adapterFactory.invalidateAdapter(merchant);
        return { outcome: "processed", event: "order.cancelled" };

      default:
        this.logger.warn(
          `vtex_webhook_unhandled_status: merchant=${merchant} orderId=${orderId} status=${status}`,
        );
        return { outcome: "ignored", reason: `unhandled_status:${status}` };
    }
  }

  private async dispatchPaidEvent(input: {
    merchantId: string;
    payload: VtexWebhookPayload;
  }): Promise<void> {
    const orderId = String(input.payload.orderId ?? "").trim();
    if (!orderId) return;

    const paymentReference = `vtex:${orderId}:${input.payload.status ?? "payment-approved"}`;
    const reserved = await this.paidDedup.tryReserve(
      input.merchantId,
      paymentReference,
    );
    if (!reserved) return;

    const event = createCommerceEventEnvelope({
      eventType: "commerce.order.paid",
      merchantId: input.merchantId,
      payload: {
        commerce_order_id: orderId,
        payment_reference: paymentReference,
        provider: "vtex",
      },
      causationId: `vtex.order.${input.payload.status ?? "payment-approved"}`,
    });
    await this.paidDedup.markProcessed(
      input.merchantId,
      paymentReference,
      orderId,
      event,
    );
  }
}

/** VTEX Order Hook payload — only the routing fields are required. */
export type VtexWebhookPayload = {
  orderId?: string;
  orderGroup?: string;
  status?: string;
  accountName?: string;
  timestamp?: string;
  [k: string]: unknown;
};
