import type { DomainEventEnvelope } from "@zyon/shared-types";
import type { ShipmentSnapshot, ShipmentStatus } from "../entities/shipment.entity.js";
import type { TrackingEventSnapshot } from "../entities/tracking-event.entity.js";

export const FULFILLMENT_TRANSITION_REPOSITORY = Symbol("FULFILLMENT_TRANSITION_REPOSITORY");

/** The database boundary for one carrier observation and all of its durable effects. */
export interface FulfillmentTransitionRepository {
  persist(input: {
    previousStatus: ShipmentStatus;
    shipment: ShipmentSnapshot;
    trackingEvent: TrackingEventSnapshot;
    outboxEvents: DomainEventEnvelope[];
  }): Promise<void>;
}
