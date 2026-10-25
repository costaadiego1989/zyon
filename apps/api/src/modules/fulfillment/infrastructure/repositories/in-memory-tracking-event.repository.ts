import { Injectable } from "@nestjs/common";
import { TrackingEventEntity } from "../../domain/entities/tracking-event.entity.js";
import type { TrackingEventRepository } from "../../domain/ports/tracking-event-repository.port.js";

@Injectable()
export class InMemoryTrackingEventRepository implements TrackingEventRepository {
  private readonly store: TrackingEventEntity[] = [];

  async save(event: TrackingEventEntity): Promise<void> {
    if (!this.store.some((stored) => stored.id === event.id)) this.store.push(event);
  }

  async findByShipment(shipmentId: string): Promise<TrackingEventEntity[]> {
    return this.store.filter((e) => e.snapshot().shipment_id === shipmentId);
  }
}
