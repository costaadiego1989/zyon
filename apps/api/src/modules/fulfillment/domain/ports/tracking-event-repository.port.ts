import type { TrackingEventEntity } from "../entities/tracking-event.entity.js";

export const TRACKING_EVENT_REPOSITORY = Symbol("TRACKING_EVENT_REPOSITORY");

export interface TrackingEventRepository {
  save(event: TrackingEventEntity): Promise<void>;
  findByShipment(shipmentId: string): Promise<TrackingEventEntity[]>;
}
