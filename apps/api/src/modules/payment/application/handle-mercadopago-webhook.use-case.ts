import { BadRequestException, Inject, Injectable, Optional, Logger } from "@nestjs/common";
import { createHmac } from "node:crypto";
import {
  PAYMENT_REPOSITORY,
  type PaymentRepository,
  type ProviderEventKey
} from "../domain/ports/payment-repository.port.js";
import { MetricsService } from "../../../shared/observability/metrics.service.js";
import { PaymentDispatchService } from "./services/payment-dispatch.service.js";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";

export type MercadoPagoWebhookInbound = {
  action?: string;
  type?: string;
  data?: { id?: string | number };
};

export type HandleMercadoPagoWebhookResult =
  | { outcome: "duplicate" }
  | { outcome: "ignored"; reason: string }
  | { outcome: "processed"; effect: string };

function normalizeInbound(body: unknown): MercadoPagoWebhookInbound {
  if (!body || typeof body !== "object") throw new BadRequestException("mercadopago_webhook_invalid_body");
  const o = body as Record<string, unknown>;
  const action = typeof o.action === "string" ? o.action.trim() : undefined;
  const type = typeof o.type === "string" ? o.type.trim() : undefined;
  let data: MercadoPagoWebhookInbound["data"];
  if (o.data && typeof o.data === "object" && !Array.isArray(o.data)) {
    const d = o.data as Record<string, unknown>;
    const id = d.id;
    data = {
      id: typeof id === "string" ? id : typeof id === "number" ? id : undefined
    };
  }
  return { action, type, data };
}

export class UnauthorizedWebhookError extends Error {
  private readonly logger = new Logger(UnauthorizedWebhookError.name);

  constructor() {
    super("mercadopago_webhook_signature_invalid");
    this.name = "UnauthorizedWebhookError";
  }
}

/**
 * Validates MercadoPago webhook signature.
 * Format: x-signature header contains "ts=TIMESTAMP,v1=HMAC_SHA256"
 * Template: id:{data.id};request-id:{x-request-id};ts:{ts};
 * HMAC is computed with webhook secret key.
 */
export function assertWebhookSignature(
  rawBody: string,
  signature: string | undefined,
  xRequestId: string | undefined,
  webhookSecret: string | undefined
): void {
  // FAIL-CLOSED: if no webhook secret is configured, reject all incoming webhooks.
  if (!webhookSecret) throw new UnauthorizedWebhookError();

  if (!signature) throw new UnauthorizedWebhookError();

  // Parse signature header: "ts=TIMESTAMP,v1=HMAC"
  const parts = signature.split(",");
  let ts = "";
  let v1 = "";
  for (const part of parts) {
    if (part.startsWith("ts=")) {
      ts = part.slice(3).trim();
    } else if (part.startsWith("v1=")) {
      v1 = part.slice(3).trim();
    }
  }

  if (!ts || !v1) throw new UnauthorizedWebhookError();

  // Parse JSON to extract payment ID
  let paymentId = "";
  try {
    const parsed = JSON.parse(rawBody);
    if (parsed.data?.id) {
      paymentId = String(parsed.data.id);
    }
  } catch {
    throw new UnauthorizedWebhookError();
  }

  // Build template: "id:{paymentId};request-id:{xRequestId};ts:{ts};"
  const template = `id:${paymentId};request-id:${xRequestId || ""};ts:${ts};`;

  // Compute HMAC-SHA256
  const computed = createHmac("sha256", webhookSecret).update(template).digest("hex");

  // Timing-safe comparison
  if (v1.length !== computed.length) throw new UnauthorizedWebhookError();
  const bufferExpected = Buffer.from(computed, "hex");
  const bufferGot = Buffer.from(v1, "hex");
  let equal = true;
  for (let i = 0; i < bufferExpected.length; i++) {
    if (bufferExpected[i] !== bufferGot[i]) equal = false;
  }
  if (!equal) throw new UnauthorizedWebhookError();
}

@Injectable()
export class HandleMercadoPagoWebhookUseCase {
  private readonly logger = new Logger(HandleMercadoPagoWebhookUseCase.name);

  constructor(
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    private readonly paymentDispatch: PaymentDispatchService,
    @Optional() private readonly metrics?: MetricsService
  ) {}

  async execute(
    rawBody: string,
    signature: string | undefined,
    xRequestId: string | undefined,
    webhookSecret?: string
  ): Promise<HandleMercadoPagoWebhookResult> {
    const expectedSecret = webhookSecret ?? process.env.MERCADOPAGO_WEBHOOK_SECRET;
    assertWebhookSignature(rawBody, signature, xRequestId, expectedSecret);

    let body: MercadoPagoWebhookInbound;
    try {
      body = normalizeInbound(JSON.parse(rawBody));
    } catch {
      throw new BadRequestException("mercadopago_webhook_invalid_json");
    }

    if (!body.data?.id) {
      throw new BadRequestException("mercadopago_webhook_invalid_shape");
    }

    const paymentId = String(body.data.id);
    const eventKey: ProviderEventKey = { provider: "mercadopago", merchantId: null, eventId: paymentId };

    // Atomic idempotency gate: record the marker BEFORE any side effect.
    const reserved = await this.payments.recordProcessedProviderEvent(eventKey);
    if (!reserved) {
      return { outcome: "duplicate" };
    }

    try {
      const effect = await this.dispatch(body, paymentId);
      return { outcome: "processed", effect };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown_error";
      if (msg.includes("illegal_transition")) {
        this.metrics?.paymentWebhookAnomaly.inc({ provider: "mercadopago", kind: "illegal_transition" });
        this.logger.error("mercadopago.webhook.illegal_transition", {
          paymentId,
          action: body.action
        });
        return { outcome: "ignored", reason: "illegal_transition_alerted" };
      }
      // Transient failure: release the marker so re-delivery can retry.
      await this.payments.deleteProcessedProviderEvent(eventKey);
      throw e;
    }
  }

  private async dispatch(
    body: MercadoPagoWebhookInbound,
    paymentId: string
  ): Promise<string> {
    // MercadoPago sends action="payment.updated" for most payment events.
    // Type is "payment" but we need to check the status via polling/details.
    // For webhook handling, we primarily care about "payment.updated" actions.
    if (body.action !== "payment.updated") {
      return "ignored_event_action";
    }

    // At this point, we would fetch the payment details to determine the exact status,
    // but since we don't have the merchant context from the webhook, we would need
    // to resolve it from the external payment ID. For now, we log and require
    // the checkout flow to poll the status (similar to Asaas pattern where webhook
    // is informational and the UI polls for status).
    return "noop_payment_webhook_received";
  }
}
