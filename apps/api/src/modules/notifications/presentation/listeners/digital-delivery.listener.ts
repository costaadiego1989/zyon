import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";
import { DigitalFulfillmentService } from "../../application/services/digital-fulfillment.service.js";

@Injectable()
export class DigitalDeliveryListener implements OnModuleInit {
  constructor(@Inject(DOMAIN_EVENT_BUS) private readonly bus: DomainEventBus, @Inject(DigitalFulfillmentService) private readonly fulfillment: DigitalFulfillmentService) {}
  onModuleInit(): void {
    this.bus.subscribe("digital.delivery.requested", event => {
      const payload = event.payload as { merchantId?: unknown; deliveryId?: unknown };
      if (payload?.merchantId !== event.merchantId || typeof payload.deliveryId !== "string") throw new Error("digital_delivery_event_invalid");
      return this.fulfillment.deliver(event.merchantId, payload.deliveryId);
    }, "digital.delivery.v1");
  }
}
