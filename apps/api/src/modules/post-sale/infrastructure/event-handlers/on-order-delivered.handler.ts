import { Injectable, Inject, Logger, OnModuleInit } from "@nestjs/common";
import {
  DOMAIN_EVENT_BUS,
  type DomainEventBus,
  type DomainEvent,
} from "../../../../shared/events/domain-event-bus.port.js";
import { SchedulePostDeliveryFlowUseCase } from "../../application/use-cases/schedule-post-delivery-flow.use-case.js";

export interface OrderDeliveredEvent {
  type: "ORDER_DELIVERED";
  merchantId: string;
  orderId: string;
  buyerId: string;
  buyerEmail?: string;
  buyerName?: string;
  buyerPhone?: string;
}

@Injectable()
export class OnOrderDeliveredHandler implements OnModuleInit {
  private readonly logger = new Logger(OnOrderDeliveredHandler.name);

  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly eventBus: DomainEventBus,
    private readonly scheduleFlow: SchedulePostDeliveryFlowUseCase
  ) {}

  onModuleInit() {
    this.eventBus.subscribe(
      "order.delivered",
      (event) => this.onOrderDelivered(event),
      "post-sale:order.delivered"
    );
    this.logger.log("Subscribed to order.delivered events");
  }

  private async onOrderDelivered(event: DomainEvent): Promise<void> {
    try {
      const payload = event.payload as OrderDeliveredEvent;

      // Extract product name if available (simple fallback)
      const productName = "seu pedido";

      await this.scheduleFlow.execute({
        merchantId: payload.merchantId,
        orderId: payload.orderId,
        buyerId: payload.buyerId,
        buyerEmail: payload.buyerEmail,
        buyerName: payload.buyerName,
        buyerPhone: payload.buyerPhone,
        productName,
      });

      this.logger.log(
        "Scheduled post-delivery flow",
        {
          merchantId: payload.merchantId,
          orderId: payload.orderId,
          buyerId: payload.buyerId,
        }
      );
    } catch (err) {
      this.logger.error(
        "Failed to handle order.delivered event",
        { error: err instanceof Error ? err.message : String(err) }
      );
    }
  }
}
