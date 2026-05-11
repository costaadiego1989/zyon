import { Controller, Post, Body, Param } from "@nestjs/common";
import { RecordTrackingEventUseCase } from "../../application/use-cases/record-tracking-event.use-case.js";
import { SHIPMENT_REPOSITORY, type ShipmentRepository } from "../../domain/ports/shipment-repository.port.js";
import { Inject } from "@nestjs/common";
import type { ShipmentStatus } from "../../domain/entities/shipment.entity.js";

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
    const shipment = await this.shipments.findByTrackingCode(body.tracking_code);
    if (!shipment) return { ignored: true, reason: "tracking_code_not_found" };

    return this.recordTracking.execute({
      shipment_id: shipment.id,
      merchant_id: body.merchant_id,
      new_status: body.status,
      description: body.description,
      location: body.location,
      carrier_raw: { ...body.raw, carrier },
      occurred_at: new Date(body.occurred_at)
    });
  }
}
