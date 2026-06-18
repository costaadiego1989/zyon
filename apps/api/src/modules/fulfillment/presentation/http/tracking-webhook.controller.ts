import { BadRequestException, Controller, Post, Body, Param } from "@nestjs/common";
import { RecordTrackingEventUseCase } from "../../application/use-cases/record-tracking-event.use-case.js";
import { SHIPMENT_REPOSITORY, type ShipmentRepository } from "../../domain/ports/shipment-repository.port.js";
import { Inject } from "@nestjs/common";
import type { ShipmentStatus } from "../../domain/entities/shipment.entity.js";
import { NonProductionRoute } from "../../../../shared/http/non-production-route.js";

/**
 * P1 note: this webhook is @NonProductionRoute (disabled in production).
 * A production-grade implementation would authenticate the carrier request
 * (HMAC signature or shared secret) before accepting any payload.
 *
 * P2 fix applied: findByTrackingCode now requires merchantId so the lookup is
 * scoped to the tenant supplied in the body. This prevents cross-tenant
 * shipment lookup even in non-production environments.
 */
@NonProductionRoute()
@Controller("webhooks/tracking")
export class TrackingWebhookController {
  constructor(
    private readonly recordTracking: RecordTrackingEventUseCase,
    @Inject(SHIPMENT_REPOSITORY) private readonly shipments: ShipmentRepository
  ) {}

  @Post(":carrier")
  async ingest(
    @Param("carrier") carrier: string,
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
    const merchantId = typeof body.merchant_id === "string" && body.merchant_id.trim()
      ? body.merchant_id.trim()
      : null;

    if (!merchantId) {
      throw new BadRequestException("merchant_id_required");
    }

    // P2 fix: scope lookup by merchantId so this endpoint cannot be used to
    // look up shipments belonging to other tenants.
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
}
