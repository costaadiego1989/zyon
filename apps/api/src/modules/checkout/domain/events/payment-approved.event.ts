import type { DomainEvent } from "../../../../shared/events/domain-event-bus.port.js";

export const PAYMENT_APPROVED_EVENT = "payment.approved";

export interface PaymentApprovedEvent extends DomainEvent {
  readonly eventType: typeof PAYMENT_APPROVED_EVENT;
  readonly merchantId: string;
  readonly payload: {
    sessionId: string;
    externalOrderId: string;
    orderTotalMajorUnits: number;
    currency: string;
    acceptedOfferId?: string;
  };
}
