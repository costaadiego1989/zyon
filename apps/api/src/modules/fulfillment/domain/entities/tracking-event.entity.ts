import { randomUUID } from "node:crypto";
import type { ShipmentStatus } from "./shipment.entity.js";

export type TrackingEventSnapshot = {
  id: string;
  shipment_id: string;
  status: ShipmentStatus;
  description: string;
  location: string | null;
  carrier_raw: Record<string, unknown>;
  occurred_at: string;
};

export class TrackingEventEntity {
  private constructor(private readonly s: TrackingEventSnapshot) {}

  static create(input: Omit<TrackingEventSnapshot, "id">): TrackingEventEntity {
    return new TrackingEventEntity({ ...input, id: randomUUID() });
  }

  static rehydrate(s: TrackingEventSnapshot): TrackingEventEntity {
    return new TrackingEventEntity(s);
  }

  snapshot(): TrackingEventSnapshot { return { ...this.s }; }
  get id(): string { return this.s.id; }
}
