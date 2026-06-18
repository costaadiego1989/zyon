import { Injectable, Inject, OnModuleInit } from "@nestjs/common";
import { DOMAIN_EVENT_BUS, type DomainEventBus, type DomainEvent } from "../../../../shared/events/domain-event-bus.port.js";
import { CreateShipmentUseCase } from "../../application/use-cases/create-shipment.use-case.js";

@Injectable()
export class FulfillmentOnOrderCompletedHandler implements OnModuleInit {
  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly eventBus: DomainEventBus,
    private readonly createShipment: CreateShipmentUseCase
  ) {}

  onModuleInit(): void {
    this.eventBus.subscribe(
      "order.completed",
      (event) => this.handle(event),
      "fulfillment.FulfillmentOnOrderCompletedHandler"
    );
  }

  private async handle(event: DomainEvent): Promise<void> {
    const payload = event.payload as Record<string, unknown>;
    const order_id = payload["external_order_id"] as string | undefined;
    if (!order_id) return;
    await this.createShipment.execute({
      merchant_id: event.merchantId,
      order_id,
      carrier_key: "flat-rate"
    });
  }
}
