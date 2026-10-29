import { BadRequestException, Controller, Post, Body, Param, Req, UnauthorizedException } from "@nestjs/common";
import { RecordTrackingEventUseCase } from "../../application/use-cases/record-tracking-event.use-case.js";
import { SHIPMENT_REPOSITORY, type ShipmentRepository } from "../../domain/ports/shipment-repository.port.js";
import { Inject } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { ShipmentStatus } from "../../domain/entities/shipment.entity.js";

/**
 * Carrier tracking webhook (Melhor Envio, Correios, custom).
 *
 * Production-ready: authenticates the carrier request before accepting any
 * payload. Melhor Envio signs webhooks with HMAC-SHA256 over the raw body
 * using the app secret; other carriers use a shared bearer secret.
 *
 * Tenant scoping: findByTrackingCode requires merchantId so the lookup is
 * scoped to the tenant supplied in the body (no cross-tenant lookup).
 */
@Controller("webhooks/tracking")
export class TrackingWebhookController {
  constructor(
    private readonly recordTracking: RecordTrackingEventUseCase,
    @Inject(SHIPMENT_REPOSITORY) private readonly shipments: ShipmentRepository
  ) {}

  @Post(":carrier")
  async ingest(
    @Param("carrier") carrier: string,
    @Req() request: { headers: Record<string, string | string[] | undefined>; rawBody?: Buffer },
    @Body() body: {
      tracking_code: string;
      merchant_id: string;
      status: ShipmentStatus;
      description: string;
      location?: string;
      occurred_at: string;
      raw?: Record<string, unknown>;
    }
  ) {
    this.authenticateCarrier(carrier, request, body);

    if (isMelhorEnvio(carrier)) {
      return this.ingestMelhorEnvio(body);
    }

    const merchantId = typeof body.merchant_id === "string" && body.merchant_id.trim()
      ? body.merchant_id.trim()
      : null;

    if (!merchantId) {
      throw new BadRequestException("merchant_id_required");
    }

    const shipment = await this.shipments.findByTrackingCode(body.tracking_code, merchantId);
    if (!shipment) return { ignored: true, reason: "tracking_code_not_found" };

    return this.recordTracking.execute({
      shipment_id: shipment.id,
      merchant_id: merchantId,
      new_status: body.status,
      description: body.description,
      location: body.location,
      carrier_raw: { ...body.raw, carrier },
      occurred_at: new Date(body.occurred_at)
    });
  }

  /**
   * Melhor Envio does not include our merchant id in its signed payload. Its
   * `data.id` is the label id returned when we create the shipment and saved as
   * the carrier tracking code, so use that provider-owned identifier only after
   * HMAC verification to resolve the tenant safely.
   */
  private async ingestMelhorEnvio(body: unknown) {
    const payload = parseMelhorEnvioPayload(body);
    const shipment = await this.shipments.findByCarrierTrackingCode("melhor-envio", payload.labelId);
    if (!shipment) return { ignored: true, reason: "carrier_label_not_found" };

    return this.recordTracking.execute({
      shipment_id: shipment.id,
      merchant_id: shipment.merchant_id,
      new_status: payload.status,
      description: payload.description,
      carrier_raw: payload.raw,
      occurred_at: payload.occurredAt,
    });
  }

  /**
   * Authenticate the carrier webhook. Melhor Envio uses HMAC-SHA256 over the
   * raw body; other carriers fall back to a shared bearer secret. If no secret
   * is configured for the carrier, the request is rejected (fail closed).
   */
  private authenticateCarrier(
    carrier: string,
    request: { headers: Record<string, string | string[] | undefined>; rawBody?: Buffer },
    body: unknown,
  ): void {
    const carrierKey = carrier.toLowerCase();

    if (isMelhorEnvio(carrierKey)) {
      const secret = process.env.MELHOR_ENVIO_WEBHOOK_SECRET;
      if (!secret) throw new UnauthorizedException("carrier_webhook_not_configured");
      const signature = header(request, "x-me-signature");
      if (!signature) throw new UnauthorizedException("missing_signature");
      if (!request.rawBody) throw new UnauthorizedException("raw_body_required");
      const expected = createHmac("sha256", secret).update(request.rawBody).digest("base64");
      if (!safeEqualBase64(signature, expected)) {
        throw new UnauthorizedException("invalid_signature");
      }
      return;
    }

    // Generic carriers: shared bearer secret
    const sharedSecret = process.env.TRACKING_WEBHOOK_SECRET;
    if (!sharedSecret) throw new UnauthorizedException("carrier_webhook_not_configured");
    const auth = header(request, "authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : auth;
    if (!token || !safeEqualHex(Buffer.from(token).toString("hex"), Buffer.from(sharedSecret).toString("hex"))) {
      throw new UnauthorizedException("invalid_webhook_secret");
    }
  }
}

function isMelhorEnvio(carrier: string): boolean {
  const carrierKey = carrier.toLowerCase();
  return carrierKey === "melhorenvio" || carrierKey === "melhor-envio";
}

type MelhorEnvioWebhookPayload = {
  labelId: string;
  status: ShipmentStatus;
  description: string;
  occurredAt: Date;
  raw: Record<string, unknown>;
};

function parseMelhorEnvioPayload(body: unknown): MelhorEnvioWebhookPayload {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new BadRequestException("melhor_envio_payload_invalid");
  }
  const raw = body as Record<string, unknown>;
  const event = stringValue(raw.event);
  const data = raw.data;
  if (!event?.startsWith("order.") || !data || typeof data !== "object" || Array.isArray(data)) {
    throw new BadRequestException("melhor_envio_payload_invalid");
  }

  const label = data as Record<string, unknown>;
  const labelId = stringValue(label.id);
  if (!labelId) throw new BadRequestException("melhor_envio_label_id_required");

  const status = melhorEnvioStatus(stringValue(label.status) ?? event.slice("order.".length));
  if (!status) throw new BadRequestException("melhor_envio_status_unsupported");

  const occurredAt = parseMelhorEnvioDate(label, status);
  return {
    labelId,
    status,
    description: `Melhor Envio: ${event}`,
    occurredAt,
    raw,
  };
}

function melhorEnvioStatus(value: string): ShipmentStatus | null {
  switch (value.trim().toLowerCase()) {
    case "created":
    case "pending": return "created";
    case "released":
    case "generated": return "label_generated";
    case "received":
    case "posted": return "dispatched";
    case "delivered": return "delivered";
    case "undelivered": return "returned";
    case "cancelled": return "cancelled";
    case "paused":
    case "suspended": return "in_transit";
    default: return null;
  }
}

function parseMelhorEnvioDate(data: Record<string, unknown>, status: ShipmentStatus): Date {
  const value = status === "delivered" ? data.delivered_at
    : status === "dispatched" ? data.posted_at
      : status === "label_generated" ? data.generated_at
        : data.created_at;
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function header(
  request: { headers: Record<string, string | string[] | undefined> },
  name: string,
): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, "hex");
    const bufB = Buffer.from(b, "hex");
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

function safeEqualBase64(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a.trim(), "base64");
    const bufB = Buffer.from(b, "base64");
    if (!bufA.length || bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}
