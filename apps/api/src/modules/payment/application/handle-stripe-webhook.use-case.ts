import { BadRequestException, Inject, Injectable, Optional } from "@nestjs/common";
import Stripe from "stripe";
import type { CurrencyCode } from "@aacp/shared-types";
import {
  PAYMENT_REPOSITORY,
  type PaymentRepository,
  type ProviderEventKey
} from "../domain/ports/payment-repository.port.js";
import type { PaymentIntentSnapshot } from "../domain/payment-intent.entity.js";
import type { CheckoutPaymentPort } from "../domain/ports/checkout-payment.port.js";
import { CHECKOUT_PAYMENT_PORT } from "../domain/ports/checkout-payment.port.js";
import { MetricsService } from "../../../shared/observability/metrics.service.js";
import { readStripeConnection } from "../infrastructure/stripe-env.js";
import { MarkCommerceOrderPaidUseCase } from "../../commerce/application/mark-commerce-order-paid.use-case.js";

export type HandleStripeWebhookResult =
  | { outcome: "duplicate" }
  | { outcome: "ignored"; reason: string }
  | { outcome: "processed"; effect: string };

export class StripeSignatureError extends Error {
  constructor() {
    super("stripe_webhook_signature_invalid");
    this.name = "StripeSignatureError";
  }
}

@Injectable()
export class HandleStripeWebhookUseCase {
  private readonly stripe: Stripe;

  constructor(
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(CHECKOUT_PAYMENT_PORT) private readonly checkoutPayment: CheckoutPaymentPort,
    @Optional() private readonly metrics?: MetricsService,
    @Optional() private readonly markCommerceOrderPaid?: MarkCommerceOrderPaidUseCase
  ) {
    const { secretKey } = readStripeConnection();
    this.stripe = new Stripe(secretKey ?? "__missing__", { apiVersion: "2026-04-22.dahlia" });
  }

  async execute(rawBody: Buffer, signature: string | undefined): Promise<HandleStripeWebhookResult> {
    const { webhookSecret } = readStripeConnection();

    if (!webhookSecret) {
      throw new BadRequestException("stripe_webhook_secret_not_configured");
    }

    if (!signature) {
      throw new StripeSignatureError();
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch {
      throw new StripeSignatureError();
    }

    return this.dispatchEvent(event);
  }

  /** Exposed for testing — bypasses signature verification. */
  async dispatchEvent(event: Stripe.Event): Promise<HandleStripeWebhookResult> {
    const merchantId = await this.resolveMerchantId(event);
    const eventKey: ProviderEventKey = { provider: "stripe", merchantId, eventId: event.id };

    if (await this.payments.hasProcessedProviderEvent(eventKey)) {
      return { outcome: "duplicate" };
    }

    const effect = await this.dispatch(event);
    await this.payments.recordProcessedProviderEvent(eventKey);
    return { outcome: "processed", effect };
  }

  private async resolveMerchantId(event: Stripe.Event): Promise<string | null> {
    const obj = event.data.object as { metadata?: Record<string, string> | null };
    const intentId = obj?.metadata?.intent_id;
    if (!intentId) return null;
    const intent = await this.payments.getIntentById(intentId);
    return intent ? intent.snapshot().merchantId : null;
  }

  private async dispatch(event: Stripe.Event): Promise<string> {
    switch (event.type) {
      case "payment_intent.succeeded":
        return this.handleSucceeded(event.data.object as Stripe.PaymentIntent);

      case "payment_intent.payment_failed":
        return this.handleFailed(event.data.object as Stripe.PaymentIntent);

      default:
        return "ignored_event_type";
    }
  }

  private async handleSucceeded(pi: Stripe.PaymentIntent): Promise<string> {
    const intentId = pi.metadata?.intent_id;
    if (!intentId) return "ignored_missing_intent_id";

    const intentEntity = await this.payments.getIntentById(intentId);
    if (!intentEntity) return "intent_not_found";

    const snap = intentEntity.snapshot();
    if (snap.status === "approved") {
      await this.markLinkedCommerceOrderPaid(snap, pi.id);
      return "already_approved";
    }

    intentEntity.markApproved({
      providerPaymentId: pi.id,
      approvedAmountCents: pi.amount_received
    });
    await this.payments.saveIntent({ intent: intentEntity });

    await this.checkoutPayment.recordPaymentStatusChanged({
      merchantId: snap.merchantId,
      sessionId: snap.sessionId,
      paymentIntentId: snap.id,
      status: "approved",
      commerceOrderId: snap.commerceOrderId
    });

    this.metrics?.paymentApproved.inc({ merchant_id: snap.merchantId });

    await this.checkoutPayment.completeAfterApproval({
      merchantId: snap.merchantId,
      sessionId: snap.sessionId,
      externalOrderId: pi.id,
      orderTotalMajorUnits: pi.amount_received / 100,
      currency: snap.currency as CurrencyCode,
      acceptedOfferId: snap.acceptedOfferId
    });

    const commerceSynced = await this.markLinkedCommerceOrderPaid(snap, pi.id);

    return commerceSynced ? "checkout_completed_after_payment_and_commerce_paid" : "checkout_completed_after_payment";
  }

  private async markLinkedCommerceOrderPaid(
    snap: PaymentIntentSnapshot,
    paymentReference: string
  ): Promise<boolean> {
    const commerceOrderId = snap.commerceOrderId?.trim();
    if (!commerceOrderId || !this.markCommerceOrderPaid) return false;

    const result = await this.markCommerceOrderPaid.execute({
      merchantId: snap.merchantId,
      commerceOrderId,
      paymentReference
    });
    return result.invokedCommerceSync;
  }

  private async handleFailed(pi: Stripe.PaymentIntent): Promise<string> {
    const intentId = pi.metadata?.intent_id;
    if (!intentId) return "ignored_missing_intent_id";

    const intentEntity = await this.payments.getIntentById(intentId);
    if (!intentEntity) return "intent_not_found";

    const snap = intentEntity.snapshot();
    if (snap.status === "approved" || snap.status === "failed") return "already_terminal";

    const reason = pi.last_payment_error?.message ?? "stripe_payment_failed";
    intentEntity.markFailed(reason);
    await this.payments.saveIntent({ intent: intentEntity });

    await this.checkoutPayment.recordPaymentStatusChanged({
      merchantId: snap.merchantId,
      sessionId: snap.sessionId,
      paymentIntentId: snap.id,
      status: "failed",
      reason,
      commerceOrderId: snap.commerceOrderId
    });

    await this.checkoutPayment.recordPaymentFailure({
      merchantId: snap.merchantId,
      sessionId: snap.sessionId,
      reason
    });

    return "payment_failed";
  }
}
