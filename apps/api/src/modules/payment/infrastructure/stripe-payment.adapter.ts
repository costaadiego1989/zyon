import { assertStandardCancellationInput, type PendingPaymentCancellationInput, type PendingPaymentCancellationResult } from "../domain/pending-payment-cancellation.js";
import { Injectable } from "@nestjs/common";
import Stripe from "stripe";
import { createHash } from "node:crypto";
import { marketplaceCaptureAccount } from "../../marketplace/infrastructure/marketplace-capture-account.js";
import type {
  CreateProviderPaymentInput,
  CreateProviderPaymentOutput,
  FetchRefundStatusInput,
  FetchRefundStatusOutput,
  RefundPaymentInput,
  FetchPaymentStatusInput,
  FetchPaymentStatusOutput,
  ReadMarketplacePaymentActionOutput,
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

  async prepareMarketplaceAccount(input: { provider: "stripe" | "asaas"; environment: "test" | "live" }) {
    if (input.provider !== "stripe") throw new Error("marketplace_capture_provider_mismatch");
    return marketplaceCaptureAccount("stripe", input.environment, this.secretKey);
  }

  async preparePayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentInput> {
    if (input.marketplaceFunding && !this.publishableKey?.startsWith(input.marketplaceFunding.environment === "test" ? "pk_test_" : "pk_live_")) {
      throw new Error("marketplace_capture_publishable_key_mismatch");
    }
    return input;
  }

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
    if (input.marketplaceFunding !== undefined) return this.recoverMarketplacePayment(input);
    // Historical requests may have automatic methods enabled. Recover by GET;
    // the current card-only creation policy must never rewrite an old request.
    const found = await this.requireStripe().paymentIntents.search({ query: `metadata['intent_id']:'${input.intentId.replace(/[^a-zA-Z0-9_-]/g, "")}'`, limit: 100 }, this.connectedAccountOptions(input));
    if (found.has_more || found.data.length > 1) throw new Error("stripe_payment_recovery_ambiguous");
    const payment = found.data[0];
    if (!payment) return null;
    if (payment.metadata.intent_id !== input.intentId || payment.metadata.merchant_id !== input.merchantId || payment.metadata.session_id !== input.sessionId || payment.amount !== input.amountCents || payment.currency.toUpperCase() !== input.currency) throw new Error("stripe_payment_recovery_mismatch");
    if (input.method !== "card" || payment.automatic_payment_methods?.enabled || payment.payment_method_types?.length !== 1 || payment.payment_method_types[0] !== "card" ||
      !["requires_payment_method", "requires_confirmation", "requires_action"].includes(payment.status)) {
      return { providerPaymentId: payment.id, status: "pending", buyerFacingPayload: {} };
    }
    if (!payment.client_secret) throw new Error("stripe_payment_recovery_mismatch");
    return { providerPaymentId: payment.id, status: "requires_action", buyerFacingPayload: { clientSecret: payment.client_secret, stripePublishableKey: this.requirePublishableKey(), stripeAccountId: input.stripeChargeMode === "direct_v2" ? input.stripeConnectAccountId : undefined } };
  }

  private async recoverMarketplacePayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentOutput | null> {
    const funding = input.marketplaceFunding;
    if (!funding || funding.hostMerchantId !== input.merchantId || funding.amountCents !== input.amountCents ||
        funding.currency !== input.currency || !/^[a-zA-Z0-9_-]+$/.test(input.intentId) ||
        input.settlementMode || input.stripeConnectAccountId || input.merchantPayoutDestination ||
        input.merchantPayoutHoldDays !== undefined || (input.platformFeeCents ?? 0) !== 0 || input.creditCard || input.creditCardHolderInfo) {
      throw new Error("marketplace_payment_identity_invalid");
    }
    const proof: FetchPaymentStatusInput = { merchantId: input.merchantId, provider: input.provider,
      providerPaymentId: "pi_recovery_lookup", providerAccountFingerprint: input.providerAccountFingerprint,
      marketplaceAccount: funding, marketplacePayment: { intentId: input.intentId, sessionId: input.sessionId,
        amountCents: input.amountCents, currency: input.currency, method: input.method } };
    await this.assertMarketplaceStatusInput(proof);
    // Historical journals used automatic methods. Replaying their key with
    // today's card-only body would change the request, so recovery never POSTs.
    // Search can lag creation; an empty result leaves the durable lease uncertain.
    const stripe = this.requireStripe();
    const found = await stripe.paymentIntents.search({ query: `metadata['intent_id']:'${input.intentId}'`, limit: 100 });
    if (!Array.isArray(found.data) || found.has_more || found.data.length > 1) throw new Error("stripe_payment_recovery_ambiguous");
    const candidate = found.data[0];
    if (!candidate) return null;
    if (!candidate.id?.startsWith("pi_")) throw new Error("marketplace_payment_identity_mismatch");
    proof.providerPaymentId = candidate.id;
    const payment = await stripe.paymentIntents.retrieve(candidate.id, { expand: ["latest_charge"] });
    this.assertMarketplacePayment(proof, payment);
    if (payment.status === "succeeded") return { providerPaymentId: payment.id, status: "pending", buyerFacingPayload: {} };
    if (payment.automatic_payment_methods?.enabled || payment.payment_method_types?.length !== 1 || payment.payment_method_types[0] !== "card") {
      throw new Error("marketplace_payment_recovery_method_review_required");
    }
    if (!["requires_payment_method", "requires_confirmation", "requires_action"].includes(payment.status)) {
      return { providerPaymentId: payment.id, status: "pending", buyerFacingPayload: {} };
    }
    if (!payment.client_secret) throw new Error("stripe_payment_recovery_mismatch");
    await this.preparePayment(input);
    return { providerPaymentId: payment.id, status: "requires_action",
      buyerFacingPayload: { clientSecret: payment.client_secret, stripePublishableKey: this.requirePublishableKey() } };
  }

  async createPayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentOutput> {
    if (input.method !== "card") throw new Error("payment_method_not_supported");
    await this.preparePayment(input);
    if (input.creditCard) {
      throw new Error("stripe_raw_card_forbidden");
    }

    const paymentIntentParams: Stripe.PaymentIntentCreateParams = {
      amount: input.amountCents,
      currency: input.currency.toLowerCase(),
      payment_method_types: ["card"],
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
    const marketplace = input.marketplaceAccount !== undefined || input.marketplacePayment !== undefined;
    if (marketplace) await this.assertMarketplaceStatusInput(input);
    const pi = await this.requireStripe().paymentIntents.retrieve(input.providerPaymentId,
      marketplace ? { expand: ["latest_charge"] } : undefined, marketplace ? undefined : this.connectedAccountOptions(input));
    if (marketplace) this.assertMarketplacePayment(input, pi);
    return {
      state: stripeStateFromStatus(pi.status),
      approvedAmountCents: pi.amount_received || undefined
    };
  }

  async readMarketplacePaymentAction(input: FetchPaymentStatusInput): Promise<ReadMarketplacePaymentActionOutput> {
    const environment = input.marketplaceAccount?.environment;
    if (environment !== "test" && environment !== "live") throw new Error("marketplace_payment_resume_identity_invalid");
    await this.assertMarketplaceStatusInput(input);
    const live = environment === "live";
    const pi = await this.requireStripe().paymentIntents.retrieve(input.providerPaymentId, { expand: ["latest_charge", "payment_method"] });
    this.assertMarketplacePayment(input, pi);
    const known = new Set(["requires_payment_method", "requires_action", "processing", "succeeded", "canceled", "requires_confirmation", "requires_capture"]);
    const providerStatus = known.has(pi.status) ? pi.status : "unknown";
    const none = (reason: ReadMarketplacePaymentActionOutput["reason"]): ReadMarketplacePaymentActionOutput =>
      ({ providerStatus, action: null, reason });
    if (providerStatus === "processing") return none("payment_processing");
    if (providerStatus === "succeeded" || providerStatus === "canceled") return none("payment_terminal");
    if (pi.automatic_payment_methods?.enabled || pi.payment_method_types?.length !== 1 || pi.payment_method_types[0] !== "card" ||
      pi.capture_method !== "automatic" || pi.confirmation_method !== "automatic") return none("payment_action_unavailable");
    let kind: "stripe_card_entry" | "stripe_card_3ds";
    if (providerStatus === "requires_payment_method") {
      // A failed/attached card is a new authorization attempt, not restoration of the initial form.
      if (pi.payment_method !== null || pi.latest_charge !== null || pi.last_payment_error !== null) return none("payment_retry_not_authorized");
      kind = "stripe_card_entry";
    } else if (providerStatus === "requires_action") {
      if (pi.last_payment_error !== null) return none("payment_retry_not_authorized");
      const method = typeof pi.payment_method === "object" ? pi.payment_method : null;
      if (!method || method.object !== "payment_method" || method.type !== "card" || method.livemode !== live ||
        !method.id?.startsWith("pm_") || !["use_stripe_sdk", "redirect_to_url"].includes(pi.next_action?.type ?? "")) {
        return none("payment_action_unavailable");
      }
      if (pi.latest_charge != null) {
        const charge = typeof pi.latest_charge === "object" ? pi.latest_charge : null;
        if (!charge || charge.object !== "charge" || charge.payment_intent !== pi.id || charge.livemode !== live ||
          charge.amount !== input.marketplacePayment!.amountCents || charge.currency !== "brl" || charge.payment_method !== method.id ||
          charge.transfer_data != null || charge.transfer != null || charge.on_behalf_of != null || charge.application_fee != null ||
          (charge.application_fee_amount ?? 0) !== 0) throw new Error("marketplace_payment_resume_identity_mismatch");
      }
      kind = "stripe_card_3ds";
    } else return none("payment_action_unavailable");
    const publishableKey = this.requirePublishableKey();
    if (!(live ? /^pk_live_[A-Za-z0-9]+$/ : /^pk_test_[A-Za-z0-9]+$/).test(publishableKey) || publishableKey.length > 500 ||
      typeof pi.client_secret !== "string" || !pi.client_secret.startsWith(`${pi.id}_secret_`) ||
      !/^pi_[A-Za-z0-9_]+_secret_[A-Za-z0-9_]+$/.test(pi.client_secret) || pi.client_secret.length > 500) {
      throw new Error("marketplace_payment_resume_credentials_invalid");
    }
    return { providerStatus, action: { kind, clientSecret: pi.client_secret, publishableKey }, reason: null };
  }

  private async assertMarketplaceStatusInput(input: FetchPaymentStatusInput): Promise<void> {
    const account = input.marketplaceAccount, payment = input.marketplacePayment;
    if (!account || !payment || input.provider !== "stripe" || account.provider !== "stripe" || input.settlementMode ||
        input.providerAccountFingerprint !== account.accountFingerprint || !/^[a-f0-9]{64}$/.test(account.accountFingerprint) ||
        !input.merchantId?.trim() || !input.providerPaymentId?.startsWith("pi_") || !payment.intentId?.trim() ||
        !payment.sessionId?.trim() || payment.currency !== "BRL" || payment.method !== "card" ||
        !Number.isSafeInteger(payment.amountCents) || payment.amountCents <= 0) throw new Error("marketplace_payment_identity_invalid");
    const actual = await this.prepareMarketplaceAccount(account);
    if (actual.accountFingerprint !== account.accountFingerprint) throw new Error("marketplace_capture_account_mismatch");
  }

  private assertMarketplacePayment(input: FetchPaymentStatusInput, pi: Stripe.PaymentIntent): void {
    const payment = input.marketplacePayment!, live = input.marketplaceAccount!.environment === "live";
    if (!pi || pi.object !== "payment_intent" || pi.id !== input.providerPaymentId || pi.livemode !== live ||
        pi.currency !== payment.currency.toLowerCase() || pi.amount !== payment.amountCents ||
        pi.metadata?.intent_id !== payment.intentId || pi.metadata?.merchant_id !== input.merchantId ||
        pi.metadata?.session_id !== payment.sessionId || pi.transfer_data != null || pi.on_behalf_of != null ||
        (pi.application_fee_amount ?? 0) !== 0) throw new Error("marketplace_payment_identity_mismatch");
    if (pi.status !== "succeeded") return;
    const charge = typeof pi.latest_charge === "object" ? pi.latest_charge : null;
    // The advertised methods can contain several choices. The captured charge
    // proves the actual instrument and the unsplit amount paid to this account.
    if (pi.amount_received !== payment.amountCents || pi.amount_capturable !== 0 || !charge ||
        !charge.id?.startsWith("ch_") || charge.object !== "charge" || charge.payment_intent !== pi.id ||
        charge.livemode !== live || charge.status !== "succeeded" || charge.paid !== true || charge.captured !== true ||
        charge.currency !== payment.currency.toLowerCase() || charge.amount !== payment.amountCents ||
        charge.amount_captured !== payment.amountCents || charge.amount_refunded !== 0 || charge.refunded !== false || charge.disputed !== false ||
        charge.payment_method_details?.type !== "card" || charge.transfer_data != null || charge.transfer != null ||
        charge.on_behalf_of != null || charge.source_transfer != null || charge.application_fee != null || (charge.application_fee_amount ?? 0) !== 0) {
      throw new Error("marketplace_payment_capture_mismatch");
    }
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
    const stripe = this.requireStripe();
    const options = this.connectedAccountOptions(input);
    const payment = await stripe.paymentIntents.retrieve(input.providerPaymentId, undefined, options);
    if (payment.id !== input.providerPaymentId || payment.livemode !== this.secretKey?.startsWith("sk_live_") ||
        (payment.metadata.merchant_id && payment.metadata.merchant_id !== input.merchantId) ||
        (input.stripeChargeMode === "direct_v2" && payment.metadata.merchant_id !== input.merchantId)) {
      throw new Error("refund_original_payment_mismatch");
    }
    let refund: Stripe.Refund | undefined;
    if (/^re_[A-Za-z0-9]+$/.test(input.providerRefundId)) {
      refund = await stripe.refunds.retrieve(input.providerRefundId, undefined, options);
    } else {
      // Internal pending markers are references, never Stripe object ids. Read
      // the original charge only; an empty/ambiguous list cannot authorize a POST.
      if (!input.refundReference || !Number.isSafeInteger(input.amountCents) || Number(input.amountCents) <= 0) return { state: "unknown" };
      const matches: Stripe.Refund[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 10; page++) {
        const rows = await stripe.refunds.list({ payment_intent: input.providerPaymentId, limit: 100,
          ...(cursor ? { starting_after: cursor } : {}) }, options);
        matches.push(...rows.data.filter(row => row.metadata?.refund_reference === input.refundReference &&
          row.metadata?.merchant_id === input.merchantId && row.amount === input.amountCents));
        if (!rows.has_more) {
          if (matches.length !== 1) return { state: "unknown" };
          refund = matches[0]; break;
        }
        cursor = rows.data.at(-1)?.id;
        if (!cursor) return { state: "unknown" };
      }
      if (!refund) return { state: "unknown" };
    }
    const original = typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id;
    if (original !== input.providerPaymentId ||
        (input.amountCents !== undefined && refund.amount !== input.amountCents) ||
        (input.currency && refund.currency !== input.currency.toLowerCase())) throw new Error("refund_original_payment_mismatch");
    const identity = { providerRefundId: refund.id };
    switch (refund.status) {
      case "succeeded":
        return { state: "succeeded", ...identity };
      case "failed":
      case "canceled":
        return { state: "failed", ...identity };
      case "pending":
      case "requires_action":
        return { state: "pending", ...identity };
      default:
        return { state: "unknown", ...identity };
    }
  }

  private requireStripe(): Stripe {
    if (!this.secretKey) throw new Error("stripe_not_configured");
    this.stripe ??= new Stripe(this.secretKey, { apiVersion: "2026-04-22.dahlia" });
    return this.stripe;
  }

  async readRefundRecoveryEligibility(input: RefundPaymentInput): Promise<boolean> {
    if (input.stripeChargeMode !== "direct_v2" || !input.idempotencyKey || !Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) return false;
    const stripe = this.requireStripe(), options = this.connectedAccountOptions(input);
    const payment = await stripe.paymentIntents.retrieve(input.providerPaymentId, undefined, options);
    if (payment.id !== input.providerPaymentId || payment.status !== "succeeded" || payment.livemode !== this.secretKey?.startsWith("sk_live_") ||
        payment.metadata.merchant_id !== input.merchantId || payment.currency !== "brl" || payment.amount_received !== input.amountCents) return false;
    const refunds = await stripe.refunds.list({ payment_intent: input.providerPaymentId, limit: 1 }, options);
    return refunds.data.length === 0 && refunds.has_more === false;
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
      metadata: { merchant_id: input.merchantId, ...(input.idempotencyKey ? { refund_reference: input.idempotencyKey } : {}) },
    }, {
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      ...this.connectedAccountOptions(input),
    });
    return { refundId: refund.id, status: refund.status === "succeeded" ? "succeeded" as const :
      refund.status === "failed" || refund.status === "canceled" ? "failed" as const : "pending" as const };
  }

  private connectedAccountOptions(input: { stripeConnectAccountId?: string; stripeChargeMode?: "direct_v2" }): Stripe.RequestOptions | undefined {
    if (input.stripeChargeMode !== "direct_v2") return undefined;
    if (!/^acct_[A-Za-z0-9]+$/.test(input.stripeConnectAccountId ?? "")) throw new Error("stripe_original_account_unproven");
    return { stripeAccount: input.stripeConnectAccountId };
  }
}
