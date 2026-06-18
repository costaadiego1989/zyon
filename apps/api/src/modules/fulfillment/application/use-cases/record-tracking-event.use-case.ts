import { Injectable, Inject, NotFoundException } from "@nestjs/common";
import { SHIPMENT_REPOSITORY, type ShipmentRepository } from "../../domain/ports/shipment-repository.port.js";
import { TRACKING_EVENT_REPOSITORY, type TrackingEventRepository } from "../../domain/ports/tracking-event-repository.port.js";
import { TrackingEventEntity } from "../../domain/entities/tracking-event.entity.js";
import type { ShipmentStatus } from "../../domain/entities/shipment.entity.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { createFulfillmentEventEnvelope } from "../../domain/events/fulfillment-domain-event.js";

@Injectable()
export class RecordTrackingEventUseCase {
  constructor(
    @Inject(SHIPMENT_REPOSITORY) private readonly shipments: ShipmentRepository,
    @Inject(TRACKING_EVENT_REPOSITORY) private readonly trackingEvents: TrackingEventRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository
  ) {}

  async execute(input: {
    shipment_id: string;
    merchant_id: string;
    new_status: ShipmentStatus;
    description: string;
    location?: string;
    carrier_raw?: Record<string, unknown>;
    occurred_at: Date;
  }) {
    const shipment = await this.shipments.findById(input.shipment_id, input.merchant_id);
    if (!shipment) throw new NotFoundException("shipment_not_found");

    const oldStatus = shipment.status;

    // P2 fix: if the incoming status equals the current status, the webhook is
    // a resend of an already-applied transition (at-least-once delivery).
    // Accept it idempotently: record the tracking event for observability but
    // skip the entity transition (which would throw INVALID_TRANSITION).
    const isSameStatus = oldStatus === input.new_status;
    const updated = isSameStatus ? shipment : shipment.transition(input.new_status);

    if (!isSameStatus) {
      await this.shipments.save(updated);
    }

    const trackingEvent = TrackingEventEntity.create({
      shipment_id: input.shipment_id,
      status: input.new_status,
      description: input.description,
      location: input.location ?? null,
      carrier_raw: input.carrier_raw ?? {},
      occurred_at: input.occurred_at.toISOString()
    });
    await this.trackingEvents.save(trackingEvent);

    if (!isSameStatus) {
      await this.outbox.appendOutbox(
        createFulfillmentEventEnvelope({
          eventType: "shipment.status-updated",
          merchantId: input.merchant_id,
          payload: {
            shipment_id: input.shipment_id,
            old_status: oldStatus,
            new_status: input.new_status,
            occurred_at: input.occurred_at.toISOString()
          }
        })
      );

      if (input.new_status === "delivered") {
        await this.outbox.appendOutbox(
          createFulfillmentEventEnvelope({
            eventType: "shipment.delivered",
            merchantId: input.merchant_id,
            payload: {
              shipment_id: input.shipment_id,
              delivered_at: input.occurred_at.toISOString()
            }
          })
        );
      }
    }

    return updated.snapshot();
  }
}
