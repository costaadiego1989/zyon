import { assertStandardCancellationInput, type PendingPaymentCancellationInput, type PendingPaymentCancellationResult } from "../domain/pending-payment-cancellation.js";
import { Injectable } from "@nestjs/common";
import Stripe from "stripe";
import { createHash } from "node:crypto";
import type {
  CreateProviderPaymentInput,
  CreateProviderPaymentOutput,
  FetchRefundStatusInput,
  FetchRefundStatusOutput,
  FetchPaymentStatusInput,
  FetchPaymentStatusOutput,
  PaymentProviderPort
} from "../domain/ports/payment-provider.port.js";

function stripeStateFromStatus(status: Stripe.PaymentIntent.Status): FetchPaymentStatusOutput["state"] {
  switch (status) {
    case "succeeded":
      return "approved";
    case "canceled":
      return "failed";
    case "processing":
    case "requires_action":
    case "requires_confirmation":
    case "requires_payment_method":
    case "requires_capture":
      return "pending";
    default:
      return "unknown";
  }
}

@Injectable()
export class StripePaymentAdapter implements PaymentProviderPort {
  private stripe?: Stripe;

  constructor(
    private readonly secretKey: string | undefined,
    private readonly publishableKey: string | undefined
  ) {}

  creationAccountFingerprint(): string { return createHash("sha256").update(this.secretKey ?? "").digest("hex"); }

  async readCancellationStatus(input: PendingPaymentCancellationInput): Promise<PendingPaymentCancellationResult> {
    assertStandardCancellationInput(input, "stripe", this.creationAccountFingerprint());
    const p = input.payment;
    if (p.method !== "card" || !/^pi_[A-Za-z0-9_]+$/.test(input.providerPaymentId)) return { state: "unsupported" };
    if (p.stripeChargeMode === "direct_v2" && !/^acct_[A-Za-z0-9]+$/.test(p.stripeConnectAccountId ?? "")) throw new Error("payment_cancellation_identity_invalid");
    const payment = await this.requireStripe().paymentIntents.retrieve(input.providerPaymentId, {}, this.connectedAccountOptions(p));
    if (payment.id !== input.providerPaymentId || payment.object !== "payment_intent" || payment.amount !== p.amountCents ||
        payment.currency !== p.currency.toLowerCase() || payment.livemode !== this.secretKey?.startsWith("sk_live_") ||
        payment.metadata.intent_id !== p.intentId || payment.metadata.merchant_id !== p.merchantId || payment.metadata.session_id !== p.sessionId) {
      throw new Error("payment_cancellation_identity_mismatch");
    }
    if (payment.status === "succeeded" || payment.status === "requires_capture" || payment.amount_received > 0 || payment.amount_capturable > 0) return { state: "paid" };
    if (payment.status === "canceled") return { state: "cancelled" };
    return { state: ["requires_payment_method", "requires_confirmation", "requires_action"].includes(payment.status) ? "pending" : "unavailable" };
  }

  async cancelPendingPayment(input: PendingPaymentCancellationInput): Promise<PendingPaymentCancellationResult> {
    const before = await this.readCancellationStatus(input);
    if (before.state !== "pending") return before;
    await this.requireStripe().paymentIntents.cancel(input.providerPaymentId, { cancellation_reason: "requested_by_customer" }, { idempotencyKey: input.idempotencyKey, ...this.connectedAccountOptions(input.payment) });
    return this.readCancellationStatus(input);
  }

  async recoverPayment(input: CreateProviderPaymentInput, firstAttemptAt: string): Promise<CreateProviderPaymentOutput | null> {
    const elapsed = Date.now() - Date.parse(firstAttemptAt);
    // Stripe v1 may prune keys after 24h. Stay below that bound; never POST an old key.
    if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 23 * 60 * 60 * 1000) return this.createPayment(input);
    const found = await this.requireStripe().paymentIntents.search(
      { query: `metadata['intent_id']:'${input.intentId.replace(/[^a-zA-Z0-9_-]/g, "")}'`, limit: 100 },
      this.connectedAccountOptions(input),
    );
    if (found.has_more || found.data.length > 1) throw new Error("stripe_payment_recovery_ambiguous");
    const payment = found.data[0];
    if (!payment) return null;
    if (payment.metadata.intent_id !== input.intentId || payment.metadata.merchant_id !== input.merchantId || payment.metadata.session_id !== input.sessionId || payment.amount !== input.amountCents || payment.currency.toUpperCase() !== input.currency || !payment.client_secret) throw new Error("stripe_payment_recovery_mismatch");
    return {
      providerPaymentId: payment.id,
      status: "requires_action",
      buyerFacingPayload: {
        clientSecret: payment.client_secret,
        stripePublishableKey: this.requirePublishableKey(),
        stripeAccountId: input.stripeChargeMode === "direct_v2" ? input.stripeConnectAccountId : undefined,
      },
    };
  }

  async createPayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentOutput> {
    if (input.creditCard) {
      throw new Error("stripe_raw_card_forbidden");
    }

    const paymentIntentParams: Stripe.PaymentIntentCreateParams = {
      amount: input.amountCents,
      currency: input.currency.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      metadata: {
        merchant_id: input.merchantId,
        session_id: input.sessionId,
        intent_id: input.intentId
      },
      description: input.description ?? `${input.merchantId}:${input.sessionId}`
    };

    if (input.stripeConnectAccountId && input.stripeChargeMode === "direct_v2") {
      // Accounts v2 Managed Risk requires a direct charge. The connected
      // account is merchant of record and the platform retains its fee.
      if (input.platformFeeCents && input.platformFeeCents > 0) paymentIntentParams.application_fee_amount = input.platformFeeCents;
    } else if (input.stripeConnectAccountId) {
      // Keep legacy destination charges for existing persisted payment intents.
      if (input.platformFeeCents && input.platformFeeCents > 0) paymentIntentParams.application_fee_amount = input.platformFeeCents;
      paymentIntentParams.transfer_data = { destination: input.stripeConnectAccountId };
    }

    const paymentIntent = await this.requireStripe().paymentIntents.create(
      paymentIntentParams,
      {
        idempotencyKey: input.providerIdempotencyKey ?? input.intentId,
        ...this.connectedAccountOptions(input),
      }
    );

    if (!paymentIntent.client_secret) {
      throw new Error("stripe_client_secret_missing");
    }

    return {
      providerPaymentId: paymentIntent.id,
      status: "requires_action",
      buyerFacingPayload: {
        clientSecret: paymentIntent.client_secret,
        stripePublishableKey: this.requirePublishableKey(),
        stripeAccountId: input.stripeChargeMode === "direct_v2" ? input.stripeConnectAccountId : undefined,
      }
    };
  }

  async fetchPaymentStatus(input: FetchPaymentStatusInput): Promise<FetchPaymentStatusOutput> {
    const pi = await this.requireStripe().paymentIntents.retrieve(
      input.providerPaymentId,
      undefined,
      this.connectedAccountOptions(input),
    );
    return {
      state: stripeStateFromStatus(pi.status),
      approvedAmountCents: pi.amount_received || undefined
    };
  }

  async cancelPayment(input: FetchPaymentStatusInput): Promise<{ state: "cancelled" | "blocked" | "unknown" }> {
    const stripe = this.requireStripe();
    const options = this.connectedAccountOptions(input);
    const payment = await stripe.paymentIntents.retrieve(input.providerPaymentId, undefined, options);
    if (payment.status === "canceled") return { state: "cancelled" };
    if (!["requires_payment_method", "requires_confirmation", "requires_action"].includes(payment.status)) return { state: "blocked" };
    const cancelled = await stripe.paymentIntents.cancel(input.providerPaymentId, { cancellation_reason: "requested_by_customer" },
      { ...options, idempotencyKey: `buyer-edit:${input.providerPaymentId}` });
    return { state: cancelled.status === "canceled" ? "cancelled" : "unknown" };
  }

  async fetchRefundStatus(input: FetchRefundStatusInput): Promise<FetchRefundStatusOutput> {
    const refund = await this.requireStripe().refunds.retrieve(
      input.providerRefundId,
      undefined,
      this.connectedAccountOptions(input),
    );
    switch (refund.status) {
      case "succeeded":
        return { state: "succeeded" };
      case "failed":
      case "canceled":
        return { state: "failed" };
      case "pending":
      case "requires_action":
        return { state: "pending" };
      default:
        return { state: "unknown" };
    }
  }

  private requireStripe(): Stripe {
    if (!this.secretKey) throw new Error("stripe_not_configured");
    this.stripe ??= new Stripe(this.secretKey, { apiVersion: "2026-04-22.dahlia" });
    return this.stripe;
  }

  private requirePublishableKey(): string {
    if (!this.publishableKey) throw new Error("stripe_publishable_key_missing");
    return this.publishableKey;
  }

  async refundPayment(input: { merchantId: string; providerPaymentId: string; amountCents: number; reason?: string; idempotencyKey?: string; stripeConnectAccountId?: string; stripeChargeMode?: "direct_v2" }) {
    const stripe = this.requireStripe();
    const refund = await stripe.refunds.create({
      payment_intent: input.providerPaymentId,
      amount: input.amountCents,
      reason: "requested_by_customer",
    }, {
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      ...this.connectedAccountOptions(input),
    });
    return { refundId: refund.id, status: refund.status === "succeeded" ? "succeeded" as const : "pending" as const };
  }

  private connectedAccountOptions(input: { stripeConnectAccountId?: string; stripeChargeMode?: "direct_v2" }): Stripe.RequestOptions | undefined {
    if (input.stripeChargeMode !== "direct_v2" || !input.stripeConnectAccountId) return undefined;
    return { stripeAccount: input.stripeConnectAccountId };
  }
}
