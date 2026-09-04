import { Injectable, Inject, Logger, OnModuleInit } from "@nestjs/common";
import {
  DOMAIN_EVENT_BUS,
  DomainEventBus,
  DomainEvent,
} from "../../../../shared/events/domain-event-bus.port.js";
import { SendOrderConfirmationUseCase } from "../../application/use-cases/send-order-confirmation.use-case.js";
import { SendOrderShippedUseCase } from "../../application/use-cases/send-order-shipped.use-case.js";
import { SendOrderDeliveredUseCase } from "../../application/use-cases/send-order-delivered.use-case.js";
import { SendReturnApprovedUseCase } from "../../application/use-cases/send-return-approved.use-case.js";
import {
  OrderConfirmationEvent,
  OrderShippedEvent,
  OrderDeliveredEvent,
  ReturnApprovedEvent,
} from "../../domain/events/notification.events.js";

@Injectable()
export class NotificationListener implements OnModuleInit {
  private readonly logger = new Logger(NotificationListener.name);

  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly eventBus: DomainEventBus,
    private readonly sendOrderConfirmation: SendOrderConfirmationUseCase,
    private readonly sendOrderShipped: SendOrderShippedUseCase,
    private readonly sendOrderDelivered: SendOrderDeliveredUseCase,
    private readonly sendReturnApproved: SendReturnApprovedUseCase,
  ) {}

  onModuleInit() {
    this.eventBus.subscribe(
      "order.confirmed",
      (event) => this.onOrderConfirmed(event),
      "notification:order.confirmed",
    );
    this.eventBus.subscribe(
      "order.shipped",
      (event) => this.onOrderShipped(event),
      "notification:order.shipped",
    );
    this.eventBus.subscribe(
      "order.delivered",
      (event) => this.onOrderDelivered(event),
      "notification:order.delivered",
    );
    this.eventBus.subscribe(
      "return.approved",
      (event) => this.onReturnApproved(event),
      "notification:return.approved",
    );
  }

  private async onOrderConfirmed(event: DomainEvent): Promise<void> {
    try {
      const payload = event.payload as OrderConfirmationEvent;
      await this.sendOrderConfirmation.execute(payload);
    } catch (err) {
      this.logger.error(`Failed to send order confirmation email:`, err);
    }
  }

  private async onOrderShipped(event: DomainEvent): Promise<void> {
    try {
      const payload = event.payload as OrderShippedEvent;
      await this.sendOrderShipped.execute(payload);
    } catch (err) {
      this.logger.error(`Failed to send order shipped email:`, err);
    }
  }

  private async onOrderDelivered(event: DomainEvent): Promise<void> {
    try {
      const payload = event.payload as OrderDeliveredEvent;
      await this.sendOrderDelivered.execute(payload);
    } catch (err) {
      this.logger.error(`Failed to send order delivered email:`, err);
    }
  }

  private async onReturnApproved(event: DomainEvent): Promise<void> {
    try {
      const payload = event.payload as ReturnApprovedEvent;
      await this.sendReturnApproved.execute(payload);
    } catch (err) {
      this.logger.error(`Failed to send return approved email:`, err);
    }
  }
}
