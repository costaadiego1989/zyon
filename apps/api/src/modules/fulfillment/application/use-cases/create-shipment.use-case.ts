import { Injectable, Inject } from "@nestjs/common";
import { ShipmentEntity } from "../../domain/entities/shipment.entity.js";
import { SHIPMENT_REPOSITORY, type ShipmentRepository } from "../../domain/ports/shipment-repository.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { createFulfillmentEventEnvelope } from "../../domain/events/fulfillment-domain-event.js";

@Injectable()
export class CreateShipmentUseCase {
  constructor(
    @Inject(SHIPMENT_REPOSITORY) private readonly repo: ShipmentRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository
  ) {}

  async execute(input: { merchant_id: string; order_id: string; carrier_key: string }) {
    const shipment = ShipmentEntity.create(input);
    await this.repo.save(shipment);

    await this.outbox.appendOutbox(
      createFulfillmentEventEnvelope({
        eventType: "shipment.created",
        merchantId: input.merchant_id,
        payload: {
          shipment_id: shipment.id,
          order_id: input.order_id,
          merchant_id: input.merchant_id,
          carrier_key: input.carrier_key
        }
      })
    );

    return shipment.snapshot();
  }
}
