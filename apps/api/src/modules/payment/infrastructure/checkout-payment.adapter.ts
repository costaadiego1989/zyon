import { Inject, Injectable } from "@nestjs/common";
import type { CheckoutPaymentApprovedInput, CheckoutPaymentPort } from "../domain/ports/checkout-payment.port.js";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../checkout/domain/ports/checkout-session.repository.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../shared/messaging/ports/outbox.repository.port.js";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../../shared/events/domain-event-bus.port.js";
import { PAYMENT_APPROVED_EVENT } from "../../checkout/domain/events/payment-approved.event.js";
import { createCheckoutEventEnvelope } from "../../checkout/domain/events/checkout-domain-event.js";
import type { PaymentIntentStatus } from "../domain/payment-intent.entity.js";

@Injectable()
export class CheckoutPaymentAdapter implements CheckoutPaymentPort {
  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    @Inject(DOMAIN_EVENT_BUS) private readonly eventBus: DomainEventBus
  ) {}

  async completeAfterApproval(input: CheckoutPaymentApprovedInput): Promise<void> {
    await this.eventBus.publish({
      eventType: PAYMENT_APPROVED_EVENT,
      merchantId: input.merchantId,
      payload: {
        sessionId: input.sessionId,
        externalOrderId: input.externalOrderId,
        orderTotalMajorUnits: input.orderTotalMajorUnits,
        currency: input.currency,
        acceptedOfferId: input.acceptedOfferId
      }
    });
    await this.sessions.appendChatTurn(input.merchantId, input.sessionId, {
      role: "agent",
      text: "Pagamento confirmado! Seu pedido foi registrado e voce recebera o codigo de rastreio no WhatsApp.",
      occurredAt: new Date().toISOString()
    });
  }

  async recordPaymentFailure({
    merchantId,
    sessionId,
    reason: _reason
  }: {
    merchantId: string;
    sessionId: string;
    reason: string;
  }): Promise<void> {
    void _reason;
    await this.sessions.recordEvent(merchantId, sessionId, "payment_failed");
    await this.sessions.appendChatTurn(merchantId, sessionId, {
      role: "agent",
      text: "Pagamento falhou. Voce pode tentar novamente por PIX ou escolher outra forma de pagamento segura.",
      occurredAt: new Date().toISOString()
    });
  }

  async recordPaymentStatusChanged({
    merchantId,
    sessionId,
    paymentIntentId,
    status,
    reason,
    commerceOrderId
  }: {
    merchantId: string;
    sessionId: string;
    paymentIntentId: string;
    status: PaymentIntentStatus;
    reason?: string;
    commerceOrderId?: string;
  }): Promise<void> {
    await this.outbox.appendOutbox(
      createCheckoutEventEnvelope({
        eventType: "payment.status.changed",
        merchantId,
        payload: {
          session_id: sessionId,
          payment_intent_id: paymentIntentId,
          status,
          reason,
          commerce_order_id: commerceOrderId
        },
        causationId: paymentIntentId
      })
    );
  }
}
