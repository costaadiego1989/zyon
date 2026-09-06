import { Injectable } from "@nestjs/common";
import Stripe from "stripe";
import { createHash } from "node:crypto";
import type {
  CreateProviderPaymentInput,
  CreateProviderPaymentOutput,
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

  async recoverPayment(input: CreateProviderPaymentInput, firstAttemptAt: string): Promise<CreateProviderPaymentOutput | null> {
    const elapsed = Date.now() - Date.parse(firstAttemptAt);
    // Stripe v1 may prune keys after 24h. Stay below that bound; never POST an old key.
    if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 23 * 60 * 60 * 1000) return this.createPayment(input);
    const found = await this.requireStripe().paymentIntents.search({ query: `metadata['intent_id']:'${input.intentId.replace(/[^a-zA-Z0-9_-]/g, "")}'`, limit: 100 });
    if (found.has_more || found.data.length > 1) throw new Error("stripe_payment_recovery_ambiguous");
    const payment = found.data[0];
    if (!payment) return null;
    if (payment.metadata.intent_id !== input.intentId || payment.metadata.merchant_id !== input.merchantId || payment.metadata.session_id !== input.sessionId || payment.amount !== input.amountCents || payment.currency.toUpperCase() !== input.currency || !payment.client_secret) throw new Error("stripe_payment_recovery_mismatch");
    return { providerPaymentId: payment.id, status: "requires_action", buyerFacingPayload: { clientSecret: payment.client_secret, stripePublishableKey: this.requirePublishableKey() } };
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

    if (input.stripeConnectAccountId) {
      if (input.platformFeeCents && input.platformFeeCents > 0) paymentIntentParams.application_fee_amount = input.platformFeeCents;
      paymentIntentParams.transfer_data = { destination: input.stripeConnectAccountId };
    }

    const paymentIntent = await this.requireStripe().paymentIntents.create(
      paymentIntentParams,
      { idempotencyKey: input.providerIdempotencyKey ?? input.intentId }
    );

    if (!paymentIntent.client_secret) {
      throw new Error("stripe_client_secret_missing");
    }

    return {
      providerPaymentId: paymentIntent.id,
      status: "requires_action",
      buyerFacingPayload: {
        clientSecret: paymentIntent.client_secret,
        stripePublishableKey: this.requirePublishableKey()
      }
    };
  }

  async fetchPaymentStatus(input: FetchPaymentStatusInput): Promise<FetchPaymentStatusOutput> {
    const pi = await this.requireStripe().paymentIntents.retrieve(input.providerPaymentId);
    return {
      state: stripeStateFromStatus(pi.status),
      approvedAmountCents: pi.amount_received || undefined
    };
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

  async refundPayment(input: { merchantId: string; providerPaymentId: string; amountCents: number; reason?: string }) {
    const stripe = this.requireStripe();
    const refund = await stripe.refunds.create({
      payment_intent: input.providerPaymentId,
      amount: input.amountCents,
      reason: "requested_by_customer",
    });
    return { refundId: refund.id, status: refund.status === "succeeded" ? "succeeded" as const : "pending" as const };
  }
}
