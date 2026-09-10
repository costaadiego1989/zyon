import { Injectable, Inject, NotFoundException, BadRequestException, Logger } from "@nestjs/common";
import { ShipmentEntity } from "../../domain/entities/shipment.entity.js";
import { SHIPMENT_REPOSITORY, type ShipmentRepository } from "../../domain/ports/shipment-repository.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { createFulfillmentEventEnvelope } from "../../domain/events/fulfillment-domain-event.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

@Injectable()
export class CancelShipmentUseCase {
  private readonly logger = new Logger(CancelShipmentUseCase.name);

  constructor(
    @Inject(SHIPMENT_REPOSITORY) private readonly repo: ShipmentRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository
  ) {}

  async execute(input: { shipment_id: string; merchant_id: string }) {
    const shipment = await this.repo.findById(input.shipment_id, input.merchant_id);
    if (!shipment) throw new NotFoundException("shipment_not_found");

    // Carrier and dashboard retries are expected. Preserve the terminal
    // cancellation as an idempotent result and do not emit a second event.
    if (shipment.status === "cancelled") return shipment.snapshot();

    let cancelled: ShipmentEntity;
    try {
      cancelled = shipment.transition("cancelled");
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("INVALID_TRANSITION")) {
        throw new BadRequestException("shipment_cancellation_not_allowed");
      }
      throw error;
    }
    await this.repo.save(cancelled);

    // M3 fix: publish shipment.cancelled event so downstream systems
    // (payments, notifications) are informed of the cancellation.
    await this.outbox.appendOutbox(
      createFulfillmentEventEnvelope({
        eventType: "shipment.cancelled",
        merchantId: input.merchant_id,
        payload: {
          shipment_id: input.shipment_id,
          cancelled_at: new Date().toISOString(),
        },
      })
    );

    return cancelled.snapshot();
  }
}
