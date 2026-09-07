import type { FulfillmentTransitionRepository } from "../../domain/ports/fulfillment-transition.repository.port.js";
import type { ShipmentRepository } from "../../domain/ports/shipment-repository.port.js";
import type { TrackingEventRepository } from "../../domain/ports/tracking-event-repository.port.js";
import { ShipmentEntity } from "../../domain/entities/shipment.entity.js";
import { TrackingEventEntity } from "../../domain/entities/tracking-event.entity.js";
import type { OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";

/** Test adapter. Production uses the Prisma implementation and one database transaction. */
export class InMemoryFulfillmentTransitionRepository implements FulfillmentTransitionRepository {
  constructor(
    private readonly shipments: ShipmentRepository,
    private readonly trackingEvents: TrackingEventRepository,
    private readonly outbox: OutboxRepository,
  ) {}

  async persist(input: Parameters<FulfillmentTransitionRepository["persist"]>[0]): Promise<void> {
    if (input.shipment.status !== input.previousStatus) {
      await this.shipments.save(ShipmentEntity.rehydrate(input.shipment));
    }
    await this.trackingEvents.save(TrackingEventEntity.rehydrate(input.trackingEvent));
    for (const event of input.outboxEvents) await this.outbox.appendOutbox(event);
  }
}
