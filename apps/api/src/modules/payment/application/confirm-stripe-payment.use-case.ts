import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import Stripe from "stripe";
import type { CurrencyCode } from "@aacp/shared-types";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import { PAYMENT_REPOSITORY, type PaymentRepository } from "../domain/ports/payment-repository.port.js";
import { CHECKOUT_PAYMENT_PORT, type CheckoutPaymentPort } from "../domain/ports/checkout-payment.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../shared/messaging/ports/outbox.repository.port.js";
import { createCheckoutEventEnvelope } from "../../checkout/domain/events/checkout-domain-event.js";
import { readStripeConnection } from "../infrastructure/stripe-env.js";
import { MarkCommerceOrderPaidUseCase } from "../../commerce/application/mark-commerce-order-paid.use-case.js";

export type ConfirmStripePaymentRequest = {
  merchant_id: string;
  session_id: string;
  intent_id: string;
};

@Injectable()
export class ConfirmStripePaymentUseCase {
  private readonly stripe: Stripe;

  constructor(
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Optional() @Inject(CHECKOUT_PAYMENT_PORT) private readonly checkoutPayment?: CheckoutPaymentPort,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox?: OutboxRepository,
    @Optional() private readonly markCommerceOrderPaid?: MarkCommerceOrderPaidUseCase
  ) {
    const { secretKey } = readStripeConnection();
    this.stripe = new Stripe(secretKey ?? "__missing__", { apiVersion: "2026-04-22.dahlia" });
  }

  async execute(body: ConfirmStripePaymentRequest): Promise<{ status: string; intent_id: string }> {
    const merchantId = body.merchant_id.trim();
    const sessionId = body.session_id.trim();
    const intentId = body.intent_id.trim();

    if (!merchantId || !sessionId || !intentId) {
      throw new BadRequestException("stripe_confirm_fields_required");
    }

    const intentRow = await this.payments.getIntentById(merchantId, intentId);
    if (!intentRow) throw new NotFoundException("payment_intent_not_found");

    const snap = intentRow.snapshot();
    if (snap.sessionId !== sessionId) {
      throw new NotFoundException("payment_intent_not_found");
    }
    if (snap.method !== "card") {
      throw new BadRequestException("payment_intent_not_card");
    }
    if (snap.status === "approved") {
      return { status: "approved", intent_id: intentId };
    }
    if (snap.status !== "requires_action" || !snap.providerPaymentId) {
      throw new BadRequestException("payment_intent_not_confirmable");
    }

    const pi = await this.stripe.paymentIntents.retrieve(snap.providerPaymentId);
    if (pi.status !== "succeeded") {
      throw new BadRequestException(`stripe_payment_not_succeeded:${pi.status}`);
    }

    const intent = PaymentIntentEntity.rehydrate(snap);
    intent.markApproved({
      providerPaymentId: pi.id,
      approvedAmountCents: pi.amount_received || snap.amountCents
    });
    await this.payments.saveIntent({ intent });

    if (this.outbox) {
      await this.outbox.appendOutbox(
        createCheckoutEventEnvelope({
          eventType: "payment.status.changed",
          merchantId,
          payload: {
            session_id: sessionId,
            payment_intent_id: intentId,
            status: "approved",
            amount_cents: pi.amount_received || snap.amountCents,
            method: "card",
            commerce_order_id: snap.commerceOrderId
          },
          causationId: intentId
        })
      );
    }

    if (this.checkoutPayment) {
      await this.checkoutPayment.recordPaymentStatusChanged({
        merchantId,
        sessionId,
        paymentIntentId: intentId,
        status: "approved",
        commerceOrderId: snap.commerceOrderId
      });

      await this.checkoutPayment.completeAfterApproval({
        merchantId,
        sessionId,
        externalOrderId: pi.id,
        orderTotalMajorUnits: (pi.amount_received || snap.amountCents) / 100,
        currency: snap.currency as CurrencyCode,
        acceptedOfferId: snap.acceptedOfferId
      });
    }

    const commerceOrderId = snap.commerceOrderId?.trim();
    if (commerceOrderId && this.markCommerceOrderPaid) {
      await this.markCommerceOrderPaid.execute({
        merchantId,
        commerceOrderId,
        paymentReference: pi.id
      });
    }

    return { status: "approved", intent_id: intentId };
  }
}
