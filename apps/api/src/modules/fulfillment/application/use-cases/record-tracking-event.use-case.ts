import { Injectable, Inject, NotFoundException, BadRequestException, ConflictException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { SHIPMENT_REPOSITORY, type ShipmentRepository } from "../../domain/ports/shipment-repository.port.js";
import { FULFILLMENT_TRANSITION_REPOSITORY, type FulfillmentTransitionRepository } from "../../domain/ports/fulfillment-transition.repository.port.js";
import { TrackingEventEntity } from "../../domain/entities/tracking-event.entity.js";
import type { ShipmentStatus } from "../../domain/entities/shipment.entity.js";
import { createFulfillmentEventEnvelope } from "../../domain/events/fulfillment-domain-event.js";

@Injectable()
export class RecordTrackingEventUseCase {
  constructor(
    @Inject(SHIPMENT_REPOSITORY) private readonly shipments: ShipmentRepository,
    @Inject(FULFILLMENT_TRANSITION_REPOSITORY) private readonly transitions: FulfillmentTransitionRepository,
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
    // L3 fix: validate carrier_raw size to prevent unbounded JSON payloads.
    if (input.carrier_raw) {
      const rawSize = JSON.stringify(input.carrier_raw).length;
      if (rawSize > 16384) {
        throw new BadRequestException("carrier_raw_payload_too_large");
      }
    }

    const shipment = await this.shipments.findById(input.shipment_id, input.merchant_id);
    if (!shipment) throw new NotFoundException("shipment_not_found");

    const oldStatus = shipment.status;

    // P2 fix: if the incoming status equals the current status, the webhook is
    // a resend of an already-applied transition (at-least-once delivery).
    // Accept it idempotently: record the tracking event for observability but
    // skip the entity transition (which would throw INVALID_TRANSITION).
    const isSameStatus = oldStatus === input.new_status;

    // H2 fix: pre-validate transition before calling entity.transition().
    // If the status change is invalid, return 400 Bad Request instead of
    // letting the domain throw an Error that surfaces as 500.
    let updated: typeof shipment;
    if (isSameStatus) {
      updated = shipment;
    } else {
      try {
        updated = shipment.transition(input.new_status);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "shipment_transition_failed";
        if (msg.startsWith("INVALID_TRANSITION")) {
          throw new BadRequestException(`invalid_shipment_transition: ${oldStatus} → ${input.new_status}`);
        }
        throw err;
      }
    }

    const occurredAt = input.occurred_at.toISOString();
    const trackingEvent = TrackingEventEntity.rehydrate({
      id: stableId("tracking", input.shipment_id, input.new_status, input.description, input.location ?? null, occurredAt, input.carrier_raw ?? {}),
      shipment_id: input.shipment_id,
      status: input.new_status,
      description: input.description,
      location: input.location ?? null,
      carrier_raw: input.carrier_raw ?? {},
      occurred_at: occurredAt,
    });

    const outboxEvents = !isSameStatus ? [
      createFulfillmentEventEnvelope({
          eventType: "shipment.status-updated",
          merchantId: input.merchant_id,
          eventId: stableId("event", trackingEvent.id, "shipment.status-updated"),
          correlationId: `corr_${trackingEvent.id}`,
          occurredAt,
          payload: {
            shipment_id: input.shipment_id,
            old_status: oldStatus,
            new_status: input.new_status,
            occurred_at: occurredAt,
          }
        }),
      ...(input.new_status === "delivered" ? [
        createFulfillmentEventEnvelope({
            eventType: "shipment.delivered",
            merchantId: input.merchant_id,
            eventId: stableId("event", trackingEvent.id, "shipment.delivered"),
            correlationId: `corr_${trackingEvent.id}`,
            occurredAt,
            payload: {
              shipment_id: input.shipment_id,
              delivered_at: occurredAt,
            }
          }),
      ] : []),
    ] : [];

    try {
      await this.transitions.persist({
        previousStatus: oldStatus,
        shipment: updated.snapshot(),
        trackingEvent: trackingEvent.snapshot(),
        outboxEvents,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "fulfillment_transition_conflict") {
        const current = await this.shipments.findById(input.shipment_id, input.merchant_id);
        if (current?.status === input.new_status) return current.snapshot();
        throw new ConflictException("shipment_transition_conflict");
      }
      throw error;
    }

    return updated.snapshot();
  }
}

function stableId(namespace: string, ...parts: unknown[]): string {
  return `evt_${createHash("sha256").update(`${namespace}:${stableJson(parts)}`).digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}
