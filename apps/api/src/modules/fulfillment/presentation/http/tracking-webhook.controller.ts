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

    if (carrierKey === "melhorenvio" || carrierKey === "melhor-envio") {
      const secret = process.env.MELHOR_ENVIO_WEBHOOK_SECRET;
      if (!secret) throw new UnauthorizedException("carrier_webhook_not_configured");
      const signature = header(request, "x-melhorenvio-signature") ?? header(request, "x-signature");
      if (!signature) throw new UnauthorizedException("missing_signature");
      const payload = request.rawBody?.toString("utf8") ?? JSON.stringify(body);
      const expected = createHmac("sha256", secret).update(payload).digest("hex");
      if (!safeEqualHex(signature, expected)) {
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
