import Stripe from "stripe";
import { createHash } from "node:crypto";
import type { CreateProviderPaymentInput } from "../domain/ports/payment-provider.port.js";
import type { RetainedMerchantPaymentProvider } from "../domain/ports/retained-merchant-payment.port.js";
import { MarketplaceCaptureAdapter } from "../../marketplace/infrastructure/marketplace-capture.adapter.js";
import { MarketplacePayoutAdapter } from "../../marketplace/infrastructure/marketplace-payout.adapter.js";
import type { MarketplacePayoutRequest, MarketplacePayoutObservation } from "../../marketplace/domain/ports/marketplace-payout-provider.port.js";

/** Ordinary store orders reuse the provider's existing capture/transfer proofs. */
export class RetainedMerchantPaymentAdapter implements RetainedMerchantPaymentProvider {
  private readonly stripe?: Stripe;
  private readonly captures: MarketplaceCaptureAdapter;
  private readonly payouts: MarketplacePayoutAdapter;
  constructor(private readonly config: { stripeSecret?: string; asaasKey?: string; asaasOrigin: string }, request: typeof fetch = globalThis.fetch) {
    this.captures = new MarketplaceCaptureAdapter(config, request);
    this.payouts = new MarketplacePayoutAdapter(config, request);
    if (config.stripeSecret) this.stripe = new Stripe(config.stripeSecret, { apiVersion: "2026-04-22.dahlia",
      httpClient: Stripe.createFetchHttpClient(request), timeout: 15_000, maxNetworkRetries: 0 });
  }

  private assertInput(input: CreateProviderPaymentInput): asserts input is CreateProviderPaymentInput & { provider: "stripe" | "asaas"; providerAccountFingerprint: string } {
    if (!["stripe", "asaas"].includes(input.provider ?? "") || input.settlementMode !== "delayed_merchant_payout" ||
        input.merchantPayoutHoldDays !== 7 || input.merchantPayoutAnchor !== "fulfillment" || !input.merchantPayoutDestination ||
        input.marketplaceFunding || input.stripeChargeMode || input.stripeConnectAccountId ||
        input.currency.toUpperCase() !== "BRL" || !Number.isSafeInteger(input.amountCents) || input.amountCents <= 0 ||
        !input.merchantId || !input.sessionId || !input.intentId) throw new Error("scheduled_split_snapshot_invalid");
    const key = input.provider === "stripe" ? this.config.stripeSecret : this.config.asaasKey;
    const identity = input.provider === "stripe" ? key : `${this.config.asaasOrigin}\0${key}`;
    if (!key || createHash("sha256").update(identity!).digest("hex") !== input.providerAccountFingerprint) throw new Error("scheduled_split_account_mismatch");
  }

  async preflight(input: CreateProviderPaymentInput): Promise<void> {
    this.assertInput(input);
    if (input.provider !== "stripe") return;
    if (input.method !== "card" || !/^acct_[A-Za-z0-9]+$/.test(input.merchantPayoutDestination!)) throw new Error("scheduled_split_destination_invalid");
    const [platform, recipient] = await Promise.all([this.stripe!.accounts.retrieve(null), this.stripe!.accounts.retrieve(input.merchantPayoutDestination!)]);
    if (platform.id === recipient.id || platform.country !== "BR" || recipient.country !== "BR" ||
        !platform.charges_enabled || !platform.payouts_enabled || !recipient.payouts_enabled || recipient.capabilities?.transfers !== "active") {
      throw new Error("scheduled_split_destination_not_ready");
    }
  }

  async readCapture(input: CreateProviderPaymentInput, providerPaymentId: string) {
    this.assertInput(input);
    if (input.provider === "stripe") {
      const payment = await this.stripe!.paymentIntents.retrieve(providerPaymentId);
      if (payment.metadata.intent_id !== input.intentId || payment.metadata.merchant_id !== input.merchantId ||
          payment.metadata.session_id !== input.sessionId || payment.payment_method_types.length !== 1 || payment.payment_method_types[0] !== "card") {
        throw new Error("scheduled_split_capture_scope_mismatch");
      }
    }
    const key = input.provider === "stripe" ? this.config.stripeSecret! : this.config.asaasKey!;
    return this.captures.readCapture({ provider: input.provider, environment: input.provider === "stripe" ? (key.startsWith("sk_live_") ? "live" : "test")
      : (new URL(this.config.asaasOrigin).hostname === "api.asaas.com" ? "live" : "test"),
      accountFingerprint: input.providerAccountFingerprint, providerPaymentId, amountCents: input.amountCents, currency: "BRL" },
    { allowPendingStripeBalance: input.provider === "stripe", ...(input.provider === "asaas" ? { expectedExternalReference: input.intentId } : {}) });
  }

  async submit(input: MarketplacePayoutRequest) {
    if (!input.capture || input.capture.providerPaymentId !== input.providerPaymentId || input.capture.accountFingerprint !== input.accountFingerprint ||
        input.capture.netAmountCents < input.amountCents) throw new Error("scheduled_split_capture_required");
    return this.payouts.submit({ ...input, reservePendingStripeSource: input.provider === "stripe" });
  }

  async reconcile(input: MarketplacePayoutRequest, transferId?: string): Promise<MarketplacePayoutObservation> {
    const receipt = await this.payouts.reconcile(input, transferId);
    if (receipt.state !== "confirmed" || input.provider !== "stripe" || !input.capture) return receipt;
    const capture = await this.captures.readCapture(input.capture, { allowPendingStripeBalance: true });
    if (["provider", "environment", "accountFingerprint", "providerPaymentId", "amountCents", "currency", "sourceId", "balanceTransactionId",
      "providerFeeCents", "netAmountCents"].some(field => (capture as any)[field] !== (input.capture as any)[field])) {
      throw new Error("scheduled_split_capture_changed");
    }
    // A transfer reservation is not available merchant funds or a bank payout.
    return capture.fundsAvailable ? receipt : { state: "pending", providerTransferId: receipt.providerTransferId };
  }
}
