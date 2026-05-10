import { Injectable, Inject, OnModuleInit } from "@nestjs/common";
import type { CurrencyCode } from "@aacp/shared-types";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";
import { PAYMENT_APPROVED_EVENT, type PaymentApprovedEvent } from "../../domain/events/payment-approved.event.js";
import { CompleteOrderUseCase } from "../use-cases/complete-order.use-case.js";

@Injectable()
export class PaymentApprovedHandler implements OnModuleInit {
  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly eventBus: DomainEventBus,
    private readonly completeOrder: CompleteOrderUseCase
  ) {}

  onModuleInit(): void {
    this.eventBus.subscribe(PAYMENT_APPROVED_EVENT, (event) =>
      this.handle(event as PaymentApprovedEvent)
    );
  }

  private async handle(event: PaymentApprovedEvent): Promise<void> {
    const { sessionId, externalOrderId, orderTotalMajorUnits, currency, acceptedOfferId } = event.payload;
    await this.completeOrder.execute({
      merchant_id: event.merchantId,
      session_id: sessionId,
      external_order_id: externalOrderId,
      order_total: orderTotalMajorUnits,
      currency: currency as CurrencyCode,
      accepted_offer_id: acceptedOfferId
    });
  }
}
