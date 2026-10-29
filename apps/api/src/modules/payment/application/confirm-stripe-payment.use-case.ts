import { savePaymentTransition } from "./services/save-payment-transition.js";
import { BadRequestException, Inject, Injectable, NotFoundException, Optional , Logger} from "@nestjs/common";
import Stripe from "stripe";
import type { CurrencyCode } from "@zyon/shared-types";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import { PAYMENT_REPOSITORY, type PaymentRepository } from "../domain/ports/payment-repository.port.js";
import { CHECKOUT_PAYMENT_PORT, type CheckoutPaymentPort } from "../domain/ports/checkout-payment.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../shared/messaging/ports/outbox.repository.port.js";
import { createCheckoutEventEnvelope } from "../../checkout/domain/events/checkout-domain-event.js";
import { readStripeConnection } from "../infrastructure/stripe-env.js";
import { orderTotalCents } from "../domain/payment-amount.js";
import { isE2ePaymentStubEnabled } from "../infrastructure/e2e-payment-provider.js";
import { MarkCommerceOrderPaidUseCase } from "../../commerce/application/mark-commerce-order-paid.use-case.js";
import { CorrelationIdStorage } from "../../../shared/logger/correlation-id.storage.js";

export type ConfirmStripePaymentRequest = {
  merchant_id: string;
  session_id: string;
  intent_id: string;
};

@Injectable()
export class ConfirmStripePaymentUseCase {
  private readonly logger = new Logger(ConfirmStripePaymentUseCase.name);

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
    const original = snap.creation?.input;
    if (original?.provider && original.provider !== "stripe") {
      throw new BadRequestException("payment_intent_not_stripe");
    }
    if (snap.status === "approved") {
      return { status: "approved", intent_id: intentId };
    }
    if (snap.status !== "requires_action" || !snap.providerPaymentId) {
      throw new BadRequestException("payment_intent_not_confirmable");
    }

    // Direct charges exist on the original connected account, not the
    // platform. Never resolve a different account from today's store settings.
    const direct = original?.stripeChargeMode === "direct_v2";
    if (direct && !/^acct_[A-Za-z0-9]+$/.test(original.stripeConnectAccountId ?? "")) {
      throw new BadRequestException("stripe_original_account_unproven");
    }
    const pi = isE2ePaymentStubEnabled() && snap.providerPaymentId.startsWith("pi_e2e_")
      ? { id: snap.providerPaymentId, status: "succeeded", amount: snap.amountCents, amount_received: snap.amountCents,
          currency: snap.currency.toLowerCase(), metadata: { merchant_id: merchantId, session_id: sessionId, intent_id: intentId } }
      : await this.stripe.paymentIntents.retrieve(snap.providerPaymentId, undefined,
          direct ? { stripeAccount: original.stripeConnectAccountId } : undefined);
    if (pi.status !== "succeeded") {
      throw new BadRequestException(`stripe_payment_not_succeeded:${pi.status}`);
    }
    if (pi.id !== snap.providerPaymentId || pi.amount !== snap.amountCents || pi.currency?.toUpperCase() !== snap.currency.toUpperCase() ||
        (direct && (pi.metadata?.merchant_id !== merchantId || pi.metadata?.session_id !== sessionId || pi.metadata?.intent_id !== intentId))) {
      throw new BadRequestException("stripe_payment_confirmation_mismatch");
    }

    const intent = PaymentIntentEntity.rehydrate(snap);
    intent.markApproved({
      providerPaymentId: pi.id,
      approvedAmountCents: pi.amount_received
    });
    await savePaymentTransition(this.payments, intent);

    if (this.checkoutPayment) {
      await this.checkoutPayment.recordPaymentStatusChanged({
        merchantId,
        sessionId,
        paymentIntentId: intentId,
        status: "approved",
        commerceOrderId: snap.commerceOrderId
      });

      // amountCents inclui a taxa de serviço do buyer; subtrai p/ obter o total do pedido.
      await this.checkoutPayment.completeAfterApproval({
        paymentIntentId: snap.id, amountBreakdown: snap.amountBreakdown,
        merchantId,
        sessionId,
        externalOrderId: pi.id,
        orderTotalMajorUnits: orderTotalCents(snap.amountBreakdown, snap.amountCents) / 100,
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
