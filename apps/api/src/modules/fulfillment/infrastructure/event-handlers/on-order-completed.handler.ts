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

    // P2 fix: prefer carrier_key from event payload (forward-compatible with
    // checkout emitting the selected carrier in the future). Fall back to
    // "flat-rate" only when the event pre-dates that change.
    const carrier_key =
      typeof payload["carrier_key"] === "string" && payload["carrier_key"]
        ? (payload["carrier_key"] as string)
        : "flat-rate";

    await this.createShipment.execute({
      merchant_id: event.merchantId,
      order_id,
      carrier_key
    });
  }
}
