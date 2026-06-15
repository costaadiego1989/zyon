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
import { HandleStripePlatformEventUseCase } from "./payment-platform.use-cases.js";

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
    @Optional() private readonly markCommerceOrderPaid?: MarkCommerceOrderPaidUseCase,
    @Optional() private readonly platformEvents?: HandleStripePlatformEventUseCase,
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

      case "account.updated":
        return this.handleAccountUpdated(event.data.object as Stripe.Account);

      case "checkout.session.completed":
        return this.handleCheckoutCompleted(
          event.data.object as Stripe.Checkout.Session,
        );

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        return this.handleSubscriptionUpdated(
          event.data.object as Stripe.Subscription,
        );

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

  private async handleAccountUpdated(
    account: Stripe.Account,
  ): Promise<string> {
    const merchantId = account.metadata?.merchant_id;
    if (!merchantId || !this.platformEvents) {
      return "ignored_missing_merchant_id";
    }
    await this.platformEvents.accountUpdated({
      merchantId,
      accountId: account.id,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
      requirements: [
        ...(account.requirements?.currently_due ?? []),
        ...(account.requirements?.past_due ?? []),
      ],
    });
    return "stripe_connect_status_updated";
  }

  private async handleCheckoutCompleted(
    session: Stripe.Checkout.Session,
  ): Promise<string> {
    const merchantId =
      session.metadata?.merchant_id ?? session.client_reference_id;
    if (
      session.mode !== "subscription" ||
      !merchantId ||
      !this.platformEvents
    ) {
      return "ignored_non_billing_checkout";
    }
    await this.platformEvents.checkoutCompleted({
      merchantId,
      customerId: idFrom(session.customer),
      subscriptionId: idFrom(session.subscription),
    });
    return "billing_checkout_completed";
  }

  private async handleSubscriptionUpdated(
    subscription: Stripe.Subscription,
  ): Promise<string> {
    if (!this.platformEvents) return "ignored_platform_events_disabled";
    const raw = subscription as Stripe.Subscription & {
      current_period_end?: number;
    };
    await this.platformEvents.subscriptionUpdated({
      merchantId: subscription.metadata?.merchant_id,
      customerId: idFrom(subscription.customer) ?? "",
      subscriptionId: subscription.id,
      priceId: subscription.items.data[0]?.price.id,
      status: billingStatus(subscription.status),
      currentPeriodEnd: raw.current_period_end
        ? new Date(raw.current_period_end * 1000).toISOString()
        : undefined,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    });
    return "billing_subscription_updated";
  }
}

function idFrom(
  value:
    | string
    | { id: string }
    | null
    | undefined,
): string | undefined {
  return typeof value === "string" ? value : value?.id;
}

function billingStatus(
  status: Stripe.Subscription.Status,
):
  | "trialing"
  | "active"
  | "past_due"
  | "unpaid"
  | "paused"
  | "cancelled"
  | "incomplete" {
  switch (status) {
    case "trialing":
    case "active":
    case "past_due":
    case "unpaid":
    case "paused":
    case "incomplete":
    case "incomplete_expired":
      return status === "incomplete_expired" ? "incomplete" : status;
    case "canceled":
      return "cancelled";
    default:
      return "incomplete";
  }
}
