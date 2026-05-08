import { Inject, Injectable } from "@nestjs/common";
import type { CheckoutPaymentApprovedInput, CheckoutPaymentPort } from "../domain/ports/checkout-payment.port.js";
import {
  CHECKOUT_REPOSITORY,
  type CheckoutRepository
} from "../../checkout/domain/ports/checkout-repository.port.js";
import { CompleteOrderUseCase } from "../../checkout/application/use-cases/complete-order.use-case.js";
import { createCheckoutEventEnvelope } from "../../checkout/domain/events/checkout-domain-event.js";
import type { PaymentIntentStatus } from "../domain/payment-intent.entity.js";

@Injectable()
export class CheckoutPaymentAdapter implements CheckoutPaymentPort {
  constructor(
    @Inject(CHECKOUT_REPOSITORY) private readonly checkoutRepository: CheckoutRepository,
    private readonly completeOrder: CompleteOrderUseCase
  ) {}

  async completeAfterApproval(input: CheckoutPaymentApprovedInput): Promise<void> {
    await this.completeOrder.execute({
      merchant_id: input.merchantId,
      session_id: input.sessionId,
      external_order_id: input.externalOrderId,
      order_total: input.orderTotalMajorUnits,
      currency: input.currency,
      accepted_offer_id: input.acceptedOfferId
    });
    await this.checkoutRepository.appendChatTurn(input.merchantId, input.sessionId, {
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
    await this.checkoutRepository.recordEvent(merchantId, sessionId, "payment_failed");
    await this.checkoutRepository.appendChatTurn(merchantId, sessionId, {
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
    reason
  }: {
    merchantId: string;
    sessionId: string;
    paymentIntentId: string;
    status: PaymentIntentStatus;
    reason?: string;
  }): Promise<void> {
    await this.checkoutRepository.appendOutbox(
      createCheckoutEventEnvelope({
        eventType: "payment.status.changed",
        merchantId,
        payload: {
          session_id: sessionId,
          payment_intent_id: paymentIntentId,
          status,
          reason
        },
        causationId: paymentIntentId
      })
    );
  }
}
