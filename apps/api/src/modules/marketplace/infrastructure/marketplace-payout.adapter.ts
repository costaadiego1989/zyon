import { createHash } from "node:crypto";
import Stripe from "stripe";
import type { MarketplacePayoutProvider, MarketplacePayoutRequest, MarketplacePayoutObservation, MarketplacePayoutSubmission } from "../domain/ports/marketplace-payout-provider.port.js";
import { MarketplaceCaptureAdapter } from "./marketplace-capture.adapter.js";
import type { MarketplaceCaptureEvidence } from "../domain/ports/marketplace-capture-provider.port.js";

/** Uses the platform account that captured the immutable marketplace payment. */
export class MarketplacePayoutAdapter implements MarketplacePayoutProvider {
  private readonly stripe?: Stripe;
  private readonly captures: MarketplaceCaptureAdapter;
  constructor(private readonly config: { stripeSecret?: string; asaasKey?: string; asaasOrigin: string },
    private readonly request: typeof fetch = globalThis.fetch) {
    this.captures = new MarketplaceCaptureAdapter(config, request);
    if (config.stripeSecret) this.stripe = new Stripe(config.stripeSecret, { apiVersion: "2026-04-22.dahlia",
      httpClient: Stripe.createFetchHttpClient(request), timeout: 15_000, maxNetworkRetries: 0 });
  }

  private validate(input: MarketplacePayoutRequest): void {
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0 || input.currency !== "BRL" ||
      !input.destination?.trim() || !input.reference?.trim() || !input.providerPaymentId?.trim()) throw new Error("marketplace_payout_invalid");
    if (input.provider === "mercadopago") throw new Error("mercadopago_marketplace_commercial_integration_required");
    const key = input.provider === "stripe" ? this.config.stripeSecret : this.config.asaasKey;
    const identity = input.provider === "asaas" ? `${this.config.asaasOrigin}\0${key}` : key ?? "";
    if (!key || createHash("sha256").update(identity).digest("hex") !== input.accountFingerprint) throw new Error("marketplace_payout_account_mismatch");
    if (input.provider === "asaas") {
      const origin = new URL(this.config.asaasOrigin);
      if (origin.protocol !== "https:" || !["api-sandbox.asaas.com", "api.asaas.com"].includes(origin.hostname) || origin.port ||
          origin.username || origin.password || origin.search || origin.hash || !["/", "/v3", "/v3/"].includes(origin.pathname)) {
        throw new Error("marketplace_payout_origin_invalid");
      }
    }
  }

  async submit(input: MarketplacePayoutRequest): Promise<MarketplacePayoutSubmission> {
    this.validate(input);
    // Local validation is definitive. After issuing a POST, any exception or
    // inconclusive response is unknown: the worker must reconcile, never resend.
    let postAttempted = false;
    try {
      if (input.provider === "stripe") {
        const payment = await this.stripe!.paymentIntents.retrieve(input.providerPaymentId);
        if (payment.status !== "succeeded" || payment.amount_received < input.amountCents || payment.currency.toUpperCase() !== input.currency || !payment.latest_charge ||
          payment.transfer_data?.destination) throw new Error("marketplace_payment_not_platform_capture");
        const capture = await this.captures.readCapture({ provider: "stripe", environment: payment.livemode ? "live" : "test",
          accountFingerprint: input.accountFingerprint, providerPaymentId: input.providerPaymentId, amountCents: payment.amount, currency: input.currency });
        if (capture.netAmountCents < input.amountCents) throw new Error("marketplace_capture_net_insufficient");
        this.assertFrozenCapture(input, capture);
        postAttempted = true;
        const transfer = await this.stripe!.transfers.create({ amount: input.amountCents, currency: "brl",
          destination: input.destination, source_transaction: capture.sourceId, transfer_group: input.reference,
          metadata: { marketplace_reference: input.reference, payment_intent_id: input.providerPaymentId } },
        { idempotencyKey: input.reference });
        return { state: "pending", providerTransferId: transfer.id };
      }
      const payment = await this.asaas(`/payments/${encodeURIComponent(input.providerPaymentId)}`, {});
      if (payment.id !== input.providerPaymentId || payment.status !== "RECEIVED" ||
        !Number.isFinite(payment.value) || Math.round(payment.value * 100) < input.amountCents ||
        (Array.isArray(payment.split) && payment.split.length > 0) || payment.refundedValue > 0) {
        throw new Error("marketplace_payment_not_available_for_payout");
      }
      const capture = await this.captures.readCapture({ provider: "asaas",
        environment: new URL(this.config.asaasOrigin).hostname === "api-sandbox.asaas.com" ? "test" : "live",
        accountFingerprint: input.accountFingerprint, providerPaymentId: input.providerPaymentId,
        amountCents: Math.round(payment.value * 100), currency: input.currency });
      if (capture.netAmountCents < input.amountCents) throw new Error("marketplace_capture_net_insufficient");
      this.assertFrozenCapture(input, capture);
      postAttempted = true;
      const response = await this.asaas("/transfers/", { method: "POST", body: JSON.stringify({
        value: input.amountCents / 100, walletId: input.destination, externalReference: input.reference,
      }) });
      return typeof response.id === "string" ? { state: "pending", providerTransferId: response.id } : { state: "unknown" };
    } catch { return { state: postAttempted ? "unknown" : "not_submitted" }; }
  }

  private assertFrozenCapture(input: MarketplacePayoutRequest, actual: MarketplaceCaptureEvidence): void {
    if (!input.capture) return; // Legacy journals remain a separate reconciliation path.
    const fields = ["provider", "environment", "accountFingerprint", "providerPaymentId", "amountCents", "currency",
      "sourceId", "balanceTransactionId", "providerFeeCents", "netAmountCents"] as const;
    if (fields.some(field => actual[field] !== input.capture![field])) throw new Error("marketplace_funding_capture_changed");
  }

  async reconcile(input: MarketplacePayoutRequest, providerTransferId?: string): Promise<MarketplacePayoutObservation> {
    this.validate(input);
    if (input.provider === "stripe") {
      const candidates = providerTransferId ? [await this.stripe!.transfers.retrieve(providerTransferId)] :
        (await this.stripe!.transfers.list({ transfer_group: input.reference, limit: 2 })).data;
      if (candidates.length !== 1) return { state: "unknown" };
      const row = candidates[0]!;
      const destination = typeof row.destination === "string" ? row.destination : row.destination?.id;
      const payment = await this.stripe!.paymentIntents.retrieve(input.providerPaymentId);
      const source = typeof payment.latest_charge === "string" ? payment.latest_charge : payment.latest_charge?.id;
      const transferSource = typeof row.source_transaction === "string" ? row.source_transaction : row.source_transaction?.id;
      if (row.metadata.marketplace_reference !== input.reference || row.metadata.payment_intent_id !== input.providerPaymentId ||
        !source || source !== transferSource || (providerTransferId && row.id !== providerTransferId) ||
        destination !== input.destination || row.amount !== input.amountCents || row.currency.toUpperCase() !== input.currency) {
        throw new Error("marketplace_payout_receipt_mismatch");
      }
      if (row.reversed || row.amount_reversed > 0) {
        // A partially reversed transfer still paid part of the seller amount.
        // Its remaining exposure needs an allocation ledger, not a failed/zero
        // payment shortcut that would erase a possible debt.
        return { state: row.reversed && row.amount_reversed === row.amount ? "failed" : "unknown", providerTransferId: row.id };
      }
      return { state: "confirmed", providerTransferId: row.id };
    }
    const candidates: any[] = [];
    if (providerTransferId) candidates.push(await this.asaas(`/transfers/${encodeURIComponent(providerTransferId)}`, {}));
    else {
      // Asaas does not document an externalReference query filter. Inspect the
      // bounded history and never interpret an incomplete/empty scan as failure.
      for (let page = 0; page < 20; page++) {
        const result = await this.asaas(`/transfers?type=ASAAS_ACCOUNT&limit=100&offset=${page * 100}`, {});
        if (!Array.isArray(result.data)) return { state: "unknown" };
        candidates.push(...result.data.filter((row: any) => row.externalReference === input.reference));
        if (!result.hasMore) break;
        if (page === 19) return { state: "unknown" };
      }
    }
    if (candidates.length !== 1) return { state: "unknown" };
    const row = candidates[0];
    if (row.externalReference !== input.reference || row.walletId !== input.destination ||
      (providerTransferId && row.id !== providerTransferId) ||
      Math.round(Number(row.value) * 100) !== input.amountCents || typeof row.id !== "string") throw new Error("marketplace_payout_receipt_mismatch");
    return { state: row.status === "DONE" ? "confirmed" : ["FAILED", "CANCELLED"].includes(row.status) ? "failed" : "pending",
      providerTransferId: row.id };
  }

  private async asaas(path: string, init: RequestInit): Promise<any> {
    const response = await this.request(`${this.config.asaasOrigin.replace(/\/+$/, "").replace(/\/v3$/, "")}/v3${path}`, {
      ...init, headers: { access_token: this.config.asaasKey!, accept: "application/json", "content-type": "application/json", "user-agent": "ZyonMarketplace/1.0" },
      redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`marketplace_asaas_payout_http_${response.status}`);
    return response.json();
  }
}
