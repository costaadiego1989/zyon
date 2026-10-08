import { savePaymentTransition } from "./services/save-payment-transition.js";
import { BadRequestException, ServiceUnavailableException, Inject, Injectable, Optional , Logger} from "@nestjs/common";
import Stripe from "stripe";
import {
  PAYMENT_REPOSITORY,
  type PaymentRepository,
  type ProviderEventKey
} from "../domain/ports/payment-repository.port.js";
import { MetricsService } from "../../../shared/observability/metrics.service.js";
import { readStripeConnection } from "../infrastructure/stripe-env.js";
import { PaymentDispatchService } from "./services/payment-dispatch.service.js";
import {  HandleStripePlatformEventUseCase,} from "./payment-platform.use-cases.js";
import { CorrelationIdStorage } from "../../../shared/logger/correlation-id.storage.js";
import { STRIPE_PLATFORM_PORT, type StripePlatformPort } from "../domain/ports/payment-platform-provider.port.js";
import { HandleMarketplaceChargebackUseCase } from "../../marketplace/application/use-cases/handle-marketplace-chargeback.use-case.js";
import { ChargebackPaymentHoldUseCase, RefundPaymentHoldUseCase } from "./payment-hold.use-cases.js";
import { fundingHash, lockMarketplaceOrder } from "../../marketplace/infrastructure/repositories/prisma-marketplace-funding.repository.js";
import { marketplacePaymentStatusInput } from "../domain/marketplace-payment-status.js";
import { PAYMENT_PROVIDER_PORT, type PaymentProviderPort } from "../domain/ports/payment-provider.port.js";

export type HandleStripeWebhookResult =
  | { outcome: "duplicate" }
  | { outcome: "ignored"; reason: string }
  | { outcome: "processed"; effect: string };

export class StripeSignatureError extends Error {
  private readonly logger = new Logger(StripeSignatureError.name);

  constructor() {
    super("stripe_webhook_signature_invalid");
    this.name = "StripeSignatureError";
  }
}

@Injectable()
export class HandleStripeWebhookUseCase {
  private readonly logger = new Logger(HandleStripeWebhookUseCase.name);
  private readonly stripe: Stripe | null;

  constructor(
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    private readonly paymentDispatch: PaymentDispatchService,
    @Optional() private readonly metrics?: MetricsService,
    @Optional() private readonly platformEvents?: HandleStripePlatformEventUseCase,
    @Optional() @Inject("PRISMA_CLIENT") private readonly prisma?: any,
    @Optional() private readonly marketplaceChargeback?: HandleMarketplaceChargebackUseCase,
    @Optional() @Inject(STRIPE_PLATFORM_PORT) private readonly billingStripe?: StripePlatformPort,    @Optional() private readonly refundPaymentHold?: RefundPaymentHoldUseCase,
    @Optional() private readonly chargebackPaymentHold?: ChargebackPaymentHoldUseCase,
    @Inject(PAYMENT_PROVIDER_PORT) private readonly paymentProvider?: PaymentProviderPort,
  ) {
    const { secretKey } = readStripeConnection();
    // Stripe is optional: an Asaas-only installation must still boot.
    // The public webhook stays unavailable until its credentials are configured.
    this.stripe = secretKey ? new Stripe(secretKey, { apiVersion: "2026-04-22.dahlia" }) : null;
  }

  async execute(rawBody: Buffer, signature: string | undefined): Promise<HandleStripeWebhookResult> {
    const { webhookSecret } = readStripeConnection();

    if (!this.stripe || !webhookSecret) {
      throw new ServiceUnavailableException("stripe_webhook_not_configured");
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
        this.logger.error("stripe.webhook.illegal_transition", {
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
    const obj = event.data.object as {
      id?: string;
      metadata?: Record<string, string> | null;
      payment_intent?: string | { id?: string } | null;
    };
    if (event.type === "payment_intent.succeeded") {
      const marketplaceIntent = await this.marketplaceIntentForProviderId(obj.id);
      if (marketplaceIntent) return marketplaceIntent.snapshot().merchantId;
    }
    const intentId = obj?.metadata?.intent_id;
    const metaMerchantId = obj?.metadata?.merchant_id;
    if (intentId && metaMerchantId) {
      // Scoped lookup: trust the metadata merchant only insofar as the intent
      // actually belongs to it (ADR 0001 #3).
      const intent = await this.payments.getIntentById(metaMerchantId, intentId);
      if (intent) return intent.snapshot().merchantId;
    }
    const providerPaymentId = typeof obj.payment_intent === "string"
      ? obj.payment_intent
      : obj.payment_intent?.id;
    const reference = providerPaymentId
      ? await this.payments.getIntentReferenceByProviderPaymentId?.(providerPaymentId)
      : null;
    return reference?.merchantId ?? null;
  }

  private async marketplaceIntentForProviderId(providerPaymentId: string | undefined) {
    if (!providerPaymentId?.trim()) return null;
    const reference = await this.payments.getIntentReferenceByProviderPaymentId?.(providerPaymentId);
    const intent = reference ? await this.payments.getIntentById(reference.merchantId, reference.id) : null;
    return intent?.snapshot().creation?.input.marketplaceFunding !== undefined ? intent : null;
  }

  private async dispatch(event: Stripe.Event): Promise<string> {
    switch (event.type) {
      case "payment_intent.succeeded":
        return this.handleSucceeded(event, event.data.object as Stripe.PaymentIntent);

      case "payment_intent.payment_failed":
        return this.handleFailed(event.data.object as Stripe.PaymentIntent);

      case "account.updated":
        return this.handleAccountUpdated(event.data.object as Stripe.Account);

      case "checkout.session.completed":
        return this.handleCheckoutCompleted(
          event.data.object as Stripe.Checkout.Session,
        );

      case "charge.refunded":
        return this.handleChargeRefunded(event.data.object as Stripe.Charge);

      case "charge.dispute.created":
        return this.handleDisputeCreated(event.data.object as Stripe.Dispute);

      case "charge.dispute.updated":
      case "charge.dispute.closed":
        return this.handleDisputeStatusChanged(event.data.object as Stripe.Dispute);

      case "payment_intent.canceled":
        return this.handleCanceled(event.data.object as Stripe.PaymentIntent);

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        return this.handleSubscriptionUpdated(
          event.data.object as Stripe.Subscription,
        );

      case "invoice.created":
      case "invoice.finalized":
      case "invoice.payment_action_required":
      case "invoice.payment_failed":
      case "invoice.paid":
      case "invoice.voided":
      case "invoice.marked_uncollectible":
        return this.handleBillingInvoice(
          event,
          event.data.object as Stripe.Invoice & { subscription?: string | Stripe.Subscription | null },
        );

      default:
        return "ignored_event_type";
    }
  }

  private async handleSucceeded(event: Stripe.Event, pi: Stripe.PaymentIntent): Promise<string> {
    const intentId = pi.metadata?.intent_id;
    const metaMerchantId = pi.metadata?.merchant_id;
    // A known marketplace charge cannot be redirected to an ordinary intent by
    // event metadata. The metadata is checked against this persisted identity.
    const marketplaceIntent = await this.marketplaceIntentForProviderId(pi.id);
    if (!marketplaceIntent && (!intentId || !metaMerchantId)) return "ignored_missing_intent_id";
    const intentEntity = marketplaceIntent ?? await this.payments.getIntentById(metaMerchantId!, intentId!);
    if (!intentEntity) return "intent_not_found";

    const snap = intentEntity.snapshot();

    const marketplaceRead = marketplacePaymentStatusInput(snap);
    if (marketplaceRead) {
      const live = marketplaceRead.marketplaceAccount!.environment === "live";
      // Marketplace charges belong to the frozen platform account. A signed
      // Connect event, stale metadata or another environment is not its proof.
      if (marketplaceRead.provider !== "stripe" || event.account !== undefined || event.livemode !== live ||
          pi.livemode !== live || pi.id !== snap.providerPaymentId || pi.status !== "succeeded" ||
          pi.metadata?.merchant_id !== snap.merchantId || pi.metadata?.intent_id !== snap.id ||
          pi.metadata?.session_id !== snap.sessionId || pi.currency?.toUpperCase() !== snap.currency ||
          pi.amount !== snap.amountCents || pi.amount_received !== snap.amountCents) {
        throw new BadRequestException("marketplace_payment_event_identity_mismatch");
      }
      if (!this.paymentProvider?.fetchPaymentStatus) {
        throw new ServiceUnavailableException("marketplace_payment_confirmation_unavailable");
      }
      let proof;
      try {
        proof = await this.paymentProvider.fetchPaymentStatus(marketplaceRead);
      } catch {
        throw new ServiceUnavailableException("marketplace_payment_confirmation_unavailable");
      }
      if (proof.state !== "approved" || proof.approvedAmountCents !== snap.amountCents) {
        throw new ServiceUnavailableException("marketplace_payment_not_approved");
      }
      return this.paymentDispatch.markApprovedAndComplete(intentEntity, snap.providerPaymentId!);
    }

    // A signed amount is meaningful only in the currency of this intent.
    // Reject before any state change; a corrected delivery can be retried.
    if (typeof pi.currency !== "string" || pi.currency.toUpperCase() !== snap.currency.toUpperCase()) {
      throw new BadRequestException("stripe_currency_mismatch");
    }

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
    const subscriptionId = idFrom(session.subscription);
    if (subscriptionId && this.billingStripe) {
      await this.platformEvents.subscriptionUpdated(await this.billingStripe.retrieveBillingSubscription(subscriptionId));
    }
    return "billing_checkout_completed";
  }

  private async handleSubscriptionUpdated(
    subscription: Stripe.Subscription,
  ): Promise<string> {
    if (!this.platformEvents) return "ignored_platform_events_disabled";
    if (this.billingStripe) {
      // Read current state so delayed events cannot restore a cancelled plan.
      await this.platformEvents.subscriptionUpdated(await this.billingStripe.retrieveBillingSubscription(subscription.id));
      return "billing_subscription_updated";
    }
    const raw = subscription as Stripe.Subscription & {
      current_period_end?: number;
    };
    await this.platformEvents.subscriptionUpdated({
      merchantId: subscription.metadata?.merchant_id,
      customerId: idFrom(subscription.customer) ?? "",
      subscriptionId: subscription.id,
      priceId: subscription.items.data[0]?.price.id,
      status: billingStatus(subscription.status),
      currentPeriodEnd: (subscription.items.data[0]?.current_period_end ?? raw.current_period_end)
        ? new Date((subscription.items.data[0]?.current_period_end ?? raw.current_period_end)! * 1000).toISOString()
        : undefined,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    });
    return "billing_subscription_updated";
  }

  private async handleBillingInvoice(event: Stripe.Event, invoice: Stripe.Invoice & { subscription?: string | Stripe.Subscription | null }): Promise<string> {
    if (event.type !== "invoice.paid" && event.type !== "invoice.payment_failed") return "ignored_event_type";
    const subscriptionId = idFrom(invoice.parent?.subscription_details?.subscription ?? invoice.subscription);
    if (!subscriptionId || !this.billingStripe || !this.platformEvents) return "ignored_non_subscription_invoice";
    await this.platformEvents.subscriptionUpdated(await this.billingStripe.retrieveBillingSubscription(subscriptionId));
    return "billing_invoice_synchronized";
  }

  private async handleChargeRefunded(charge: Stripe.Charge): Promise<string> {
    const pi = charge.payment_intent;
    const piId = typeof pi === "string" ? pi : pi?.id;
    if (!piId) return "ignored_missing_payment_intent";
    const reference = await this.payments.getIntentReferenceByProviderPaymentId?.(piId);
    const merchantId = reference?.merchantId ?? charge.metadata?.merchant_id;
    const intentId = reference?.id ?? charge.metadata?.intent_id;
    if (!intentId || !merchantId) return "ignored_missing_intent_id";

    const intentEntity = await this.payments.getIntentById(merchantId, intentId);
    if (!intentEntity) return "intent_not_found";
    const snapshot = intentEntity.snapshot();
    if (snapshot.providerPaymentId !== piId ||
        (charge.metadata?.merchant_id && charge.metadata.merchant_id !== snapshot.merchantId) ||
        (charge.metadata?.intent_id && charge.metadata.intent_id !== snapshot.id)) {
      throw new BadRequestException("stripe_refund_payment_mismatch");
    }
    if (typeof charge.currency !== "string" || charge.currency.toUpperCase() !== snapshot.currency.toUpperCase() ||
        charge.amount !== snapshot.amountCents || !Number.isSafeInteger(charge.amount_refunded) ||
        charge.amount_refunded <= 0 || charge.amount_refunded > snapshot.amountCents ||
        typeof charge.refunded !== "boolean" || charge.refunded !== (charge.amount_refunded === snapshot.amountCents)) {
      throw new BadRequestException("stripe_refund_amount_mismatch");
    }

    if (snapshot.creation?.input.marketplaceFunding) {
      // This event also fires for partial refunds and does not bind a return's
      // allocation journal. Only the dedicated refund GET reconciler settles
      // marketplace accounting. Hold the original budget under the same order
      // lock as payout admission, including manual refunds without a journal.
      const frozen = snapshot.creation.input.marketplaceFunding;
      if (!["test", "live"].includes(frozen.environment) || charge.livemode !== (frozen.environment === "live")) {
        throw new BadRequestException("stripe_refund_environment_mismatch");
      }
      if (!this.prisma) throw new ServiceUnavailableException("marketplace_refund_reconciliation_unavailable");
      await this.prisma.$transaction(async (tx: any) => {
        await lockMarketplaceOrder(tx, snapshot.merchantId, piId);
        const plan = await tx.marketplaceFundingPlan.findFirst({ where: { paymentIntentId: snapshot.id, hostMerchantId: snapshot.merchantId } });
        if (!plan || plan.provider !== "stripe" || plan.providerPaymentId !== piId || plan.amountCents !== snapshot.amountCents ||
            plan.accountFingerprint !== frozen.accountFingerprint || fundingHash(frozen) !== plan.instructionsHash ||
            fundingHash(plan.instructions) !== plan.instructionsHash) {
          throw new ServiceUnavailableException("marketplace_refund_funding_reconciliation_required");
        }
        const capture = plan.budget?.capture;
        if (plan.budget && (!capture || capture.provider !== "stripe" || capture.providerPaymentId !== piId ||
            capture.sourceId !== charge.id || capture.amountCents !== snapshot.amountCents || capture.currency !== snapshot.currency ||
            capture.environment !== frozen.environment || capture.accountFingerprint !== frozen.accountFingerprint)) {
          throw new BadRequestException("stripe_refund_capture_mismatch");
        }
        await tx.marketplaceFundingPlan.update({ where: { paymentIntentId: snapshot.id }, data: { status: "held" } });
        const confirmed = await tx.marketplaceRefundPlan.aggregate({ where: { fundingPlanId: snapshot.id, hostMerchantId: snapshot.merchantId, status: "confirmed" },
          _sum: { amountCents: true } });
        if (charge.amount_refunded > (confirmed._sum.amountCents ?? 0)) {
          await tx.marketplaceResidualPlan.updateMany({ where: { fundingPlanId: snapshot.id, hostMerchantId: snapshot.merchantId, status: { not: "held" } },
            data: { status: "held", heldReason: "marketplace_residual_external_refund_requires_reconciliation" } });
        }
      });
      this.metrics?.paymentWebhookAnomaly.inc({ provider: "stripe", kind: "marketplace_refund_requires_reconciliation" });
      return "marketplace_refund_reconciliation_required";
    }
    if (charge.amount_refunded < snapshot.amountCents) return "payment_partially_refunded";

    await this.paymentDispatch.markRefunded(intentEntity, "charge.refunded");
    await this.refundPaymentHold?.execute(intentId);
    return "payment_refunded";
  }

  private async handleDisputeCreated(dispute: Stripe.Dispute): Promise<string> {
    // Dispute metadata is not inherited from the PaymentIntent. Resolve the
    // durable local intent using Stripe's PaymentIntent id first, then retain
    // metadata only as a backward-compatible fallback.
    const providerPaymentId = typeof dispute.payment_intent === "string"
      ? dispute.payment_intent
      : dispute.payment_intent?.id;
    const reference = providerPaymentId
      ? await this.payments.getIntentReferenceByProviderPaymentId?.(providerPaymentId)
      : null;
    const metaMerchantId = reference?.merchantId ?? dispute.metadata?.merchant_id;
    const intentId = reference?.id ?? dispute.metadata?.intent_id;
    if (!intentId || !metaMerchantId) {
      return "ignored_missing_intent_id";
    }

    const intentEntity = await this.payments.getIntentById(metaMerchantId, intentId);
    if (!intentEntity) return "intent_not_found";

    const reason = `dispute_created:${dispute.reason ?? "unknown"}`;
    // Move the intent to a chargeback_ status so it surfaces in the dashboard
    // chargeback list (previously this called markRefunded → status 'refunded',
    // which the chargeback list — filtering on the `chargeback_` prefix — never
    // showed).
    await this.paymentDispatch.syncChargebackStatus(
      intentEntity,
      stripeChargebackStatus(dispute.status),
      reason,
    );

    await this.chargebackPaymentHold?.execute(intentId);

    // Cross-store (marketplace) settlements of this order must be charged back
    // too: cancel the seller repasse if still scheduled, or open a seller debt
    // if the money was already transferred. No-op for pure own-store orders.
    const snap = intentEntity.snapshot();
    const orderId = snap.providerPaymentId ?? snap.commerceOrderId ?? snap.sessionId;
    if (this.marketplaceChargeback && orderId) {
      try {
        const results = await this.marketplaceChargeback.executeForOrder(orderId, snap.merchantId);
        if (results.length > 0) {
          this.logger.log(
            `Marketplace chargeback processed for order ${orderId}: ${results.length} settlement(s)`,
          );
        }
      } catch (err) {
        this.logger.error(
          `Marketplace chargeback failed for order ${orderId}: ${(err as Error).message}`,
        );
      }
    }

    return "payment_disputed";
  }

  private async handleDisputeStatusChanged(dispute: Stripe.Dispute): Promise<string> {
    const providerPaymentId = typeof dispute.payment_intent === "string"
      ? dispute.payment_intent
      : dispute.payment_intent?.id;
    const reference = providerPaymentId
      ? await this.payments.getIntentReferenceByProviderPaymentId?.(providerPaymentId)
      : null;
    const merchantId = reference?.merchantId ?? dispute.metadata?.merchant_id;
    const intentId = reference?.id ?? dispute.metadata?.intent_id;
    if (!merchantId || !intentId) return "ignored_missing_intent_id";

    const intentEntity = await this.payments.getIntentById(merchantId, intentId);
    if (!intentEntity) return "intent_not_found";

    const status = stripeChargebackStatus(dispute.status);
    await this.paymentDispatch.syncChargebackStatus(
      intentEntity,
      status,
      `stripe_dispute:${dispute.reason ?? "unknown"}`,
    );
    return `chargeback_${status}`;
  }

  private async handleCanceled(pi: Stripe.PaymentIntent): Promise<string> {
    const intentId = pi.metadata?.intent_id;
    const metaMerchantId = pi.metadata?.merchant_id;
    if (!intentId || !metaMerchantId) return "ignored_missing_intent_id";

    const intentEntity = await this.payments.getIntentById(metaMerchantId, intentId);
    if (!intentEntity) return "intent_not_found";

    const snap = intentEntity.snapshot();
    if (snap.status === "approved" || snap.status === "failed" || snap.status === "cancelled") {
      return "already_terminal";
    }

    intentEntity.markCancelled("payment_intent.canceled");
    await savePaymentTransition(this.payments, intentEntity, "payment_intent.canceled");
    return "payment_canceled";
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



function unixTimestampToIso(value: number | null | undefined): string | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return undefined;
  const date = new Date(value * 1_000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function stripeChargebackStatus(
  status: Stripe.Dispute.Status,
): "pending" | "disputed" | "lost" | "won" {
  switch (status) {
    case "under_review":
    case "warning_under_review":
      return "disputed";
    case "won":
    case "warning_closed":
    case "prevented":
      return "won";
    case "lost":
      return "lost";
    default:
      return "pending";
  }
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
      return status === "incomplete_expired" ? "cancelled" : status;
    case "canceled":
      return "cancelled";
    default:
      return "incomplete";
  }
}
