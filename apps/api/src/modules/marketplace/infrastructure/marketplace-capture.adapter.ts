import { createHash } from "node:crypto";
import Stripe from "stripe";
import type { MarketplaceCaptureProvider, MarketplaceCaptureRequest, MarketplaceCaptureEvidence } from "../domain/ports/marketplace-capture-provider.port.js";

function cents(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("marketplace_capture_amount_invalid");
  const result = Math.round(value * 100);
  if (!Number.isSafeInteger(result) || result > 2_147_483_647 || Math.abs(value * 100 - result) > 0.000001) throw new Error("marketplace_capture_amount_invalid");
  return result;
}

/** Reads capture evidence only; never creates a customer, charge or transfer. */
export class MarketplaceCaptureAdapter implements MarketplaceCaptureProvider {
  private readonly stripe?: Stripe;
  constructor(private readonly config: { stripeSecret?: string; asaasKey?: string; asaasOrigin: string },
    private readonly request: typeof fetch = globalThis.fetch) {
    if (config.stripeSecret) this.stripe = new Stripe(config.stripeSecret, { apiVersion: "2026-04-22.dahlia",
      httpClient: Stripe.createFetchHttpClient(request), timeout: 15_000, maxNetworkRetries: 0 });
  }

  async readCapture(input: MarketplaceCaptureRequest): Promise<MarketplaceCaptureEvidence> {
    if (!["stripe", "asaas"].includes(input.provider) || !["test", "live"].includes(input.environment) ||
        input.currency !== "BRL" || !Number.isSafeInteger(input.amountCents) || input.amountCents <= 0 || input.amountCents > 2_147_483_647 ||
        !input.providerPaymentId?.trim()) throw new Error("marketplace_capture_request_invalid");
    const key = input.provider === "stripe" ? this.config.stripeSecret : this.config.asaasKey;
    const identity = input.provider === "stripe" ? key : `${this.config.asaasOrigin}\0${key}`;
    if (!key || createHash("sha256").update(identity!).digest("hex") !== input.accountFingerprint) throw new Error("marketplace_capture_account_mismatch");
    if (input.provider === "stripe") {
      if (!key.startsWith(input.environment === "test" ? "sk_test_" : "sk_live_")) throw new Error("marketplace_capture_environment_mismatch");
      const payment = await this.stripe!.paymentIntents.retrieve(input.providerPaymentId);
      if (payment.id !== input.providerPaymentId || payment.status !== "succeeded" || payment.amount_received !== input.amountCents ||
          payment.amount !== input.amountCents || payment.currency !== "brl" || payment.livemode !== (input.environment === "live") ||
          payment.transfer_data || payment.application_fee_amount || payment.on_behalf_of || !payment.latest_charge) throw new Error("marketplace_capture_not_available");
      const sourceId = typeof payment.latest_charge === "string" ? payment.latest_charge : payment.latest_charge.id;
      const charge = await this.stripe!.charges.retrieve(sourceId);
      const paymentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
      if (charge.id !== sourceId || paymentId !== payment.id || !charge.paid || !charge.captured || charge.disputed || charge.refunded ||
          charge.amount_refunded !== 0 || charge.amount !== input.amountCents || charge.amount_captured !== input.amountCents ||
          charge.currency !== "brl" || charge.livemode !== payment.livemode || charge.transfer_data || charge.application_fee ||
          charge.application_fee_amount || charge.on_behalf_of || !charge.balance_transaction) throw new Error("marketplace_capture_not_available");
      const transactionId = typeof charge.balance_transaction === "string" ? charge.balance_transaction : charge.balance_transaction.id;
      const balance = await this.stripe!.balanceTransactions.retrieve(transactionId);
      const source = typeof balance.source === "string" ? balance.source : balance.source?.id;
      if (balance.id !== transactionId || source !== charge.id || balance.amount !== input.amountCents || balance.currency !== "brl" ||
          balance.type !== "charge" || balance.status !== "available" || balance.exchange_rate || !Number.isSafeInteger(balance.fee) ||
          balance.fee < 0 || balance.fee >= balance.amount || balance.net !== balance.amount - balance.fee) throw new Error("marketplace_capture_balance_not_available");
      return { ...input, sourceId, balanceTransactionId: balance.id, providerFeeCents: balance.fee, netAmountCents: balance.net };
    }
    const origin = new URL(this.config.asaasOrigin);
    const expectedHost = input.environment === "test" ? "api-sandbox.asaas.com" : "api.asaas.com";
    if (origin.protocol !== "https:" || origin.hostname !== expectedHost || origin.port || origin.username || origin.password ||
        origin.search || origin.hash || !["/", "/v3", "/v3/"].includes(origin.pathname) ||
        !key.startsWith(input.environment === "test" ? "$aact_hmlg_" : "$aact_prod_")) throw new Error("marketplace_capture_environment_mismatch");
    const response = await this.request(`${origin.origin}/v3/payments/${encodeURIComponent(input.providerPaymentId)}`, {
      headers: { access_token: key, accept: "application/json", "user-agent": "ZyonMarketplace/1.0" },
      redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`marketplace_capture_http_${response.status}`);
    const payment = await response.json() as Record<string, any>;
    if (payment.id !== input.providerPaymentId || payment.status !== "RECEIVED" || payment.deleted || payment.anticipated || payment.chargeback ||
        (payment.split != null && (!Array.isArray(payment.split) || payment.split.length > 0)) ||
        (payment.refundedValue != null && cents(payment.refundedValue) !== 0) ||
        (payment.refunds != null && (!Array.isArray(payment.refunds) || payment.refunds.some((r: any) => !["CANCELLED", "FAILED", "REFUSED"].includes(r.status)))) ||
        cents(payment.value) !== input.amountCents) throw new Error("marketplace_capture_not_available");
    const netAmountCents = cents(payment.netValue);
    if (netAmountCents <= 0 || netAmountCents > input.amountCents) throw new Error("marketplace_capture_net_invalid");
    return { ...input, sourceId: payment.id, providerFeeCents: input.amountCents - netAmountCents, netAmountCents };
  }
}
