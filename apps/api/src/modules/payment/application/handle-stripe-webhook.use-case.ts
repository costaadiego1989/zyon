import { BadRequestException, Inject, Injectable, Optional } from "@nestjs/common";
import Stripe from "stripe";
import {
  PAYMENT_REPOSITORY,
  type PaymentRepository,
  type ProviderEventKey
} from "../domain/ports/payment-repository.port.js";
import { MetricsService } from "../../../shared/observability/metrics.service.js";
import { readStripeConnection } from "../infrastructure/stripe-env.js";
import { PaymentDispatchService } from "./services/payment-dispatch.service.js";
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
    private readonly paymentDispatch: PaymentDispatchService,
    @Optional() private readonly metrics?: MetricsService,
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

    // Atomic idempotency gate: record BEFORE side effects. A concurrent
    // duplicate gets `false` and short-circuits (ADR 0001 #1).
    const reserved = await this.payments.recordProcessedProviderEvent(eventKey);
    if (!reserved) {
      return { outcome: "duplicate" };
    }

    try {
      const effect = await this.dispatch(event);
      return { outcome: "processed", effect };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown_error";
      if (msg.includes("illegal_transition")) {
        // Genuine illegal transition, not benign re-delivery. Surface it and
        // keep the marker consumed so Stripe's re-delivery does not poison-loop
        // (ADR 0001 #5/#4).
        this.metrics?.paymentWebhookAnomaly.inc({ provider: "stripe", kind: "illegal_transition" });
        console.error("[payment][stripe-webhook] illegal_transition", {
          merchantId,
          eventId: event.id,
          eventType: event.type
        });
        return { outcome: "ignored", reason: "illegal_transition_alerted" };
      }
      // Transient failure: release the marker so re-delivery can retry.
      await this.payments.deleteProcessedProviderEvent(eventKey);
      throw e;
    }
  }

  private async resolveMerchantId(event: Stripe.Event): Promise<string | null> {
    const obj = event.data.object as { metadata?: Record<string, string> | null };
    const intentId = obj?.metadata?.intent_id;
    const metaMerchantId = obj?.metadata?.merchant_id;
    if (!intentId || !metaMerchantId) return null;
    // Scoped lookup: trust the metadata merchant only insofar as the intent
    // actually belongs to it (ADR 0001 #3).
    const intent = await this.payments.getIntentById(metaMerchantId, intentId);
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
    const metaMerchantId = pi.metadata?.merchant_id;
    if (!intentId || !metaMerchantId) return "ignored_missing_intent_id";

    const intentEntity = await this.payments.getIntentById(metaMerchantId, intentId);
    if (!intentEntity) return "intent_not_found";

    const snap = intentEntity.snapshot();

    // Authoritative amount check BEFORE approval (ADR 0001 #5).
    if (snap.status !== "approved" && pi.amount_received !== snap.amountCents) {
      this.metrics?.paymentWebhookAnomaly.inc({ provider: "stripe", kind: "value_mismatch" });
      await this.paymentDispatch.markFailed(intentEntity, "stripe_value_mismatch");
      return "stripe_value_mismatch";
    }

    return this.paymentDispatch.markApprovedAndComplete(intentEntity, pi.id);
  }

  private async handleFailed(pi: Stripe.PaymentIntent): Promise<string> {
    const intentId = pi.metadata?.intent_id;
    const metaMerchantId = pi.metadata?.merchant_id;
    if (!intentId || !metaMerchantId) return "ignored_missing_intent_id";

    const intentEntity = await this.payments.getIntentById(metaMerchantId, intentId);
    if (!intentEntity) return "intent_not_found";

    const snap = intentEntity.snapshot();
    if (snap.status === "approved" || snap.status === "failed") return "already_terminal";

    const reason = pi.last_payment_error?.message ?? "stripe_payment_failed";
    await this.paymentDispatch.markFailed(intentEntity, reason);
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
