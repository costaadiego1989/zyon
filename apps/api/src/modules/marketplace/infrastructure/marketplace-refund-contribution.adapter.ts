import Stripe from "stripe";
import type { MarketplaceRefundContributionProof, MarketplaceRefundContributionRequest } from "../domain/ports/marketplace-refund-contribution.port.js";
import type { MarketplaceContributionCustomerProof, MarketplaceContributionCustomerScope, MarketplaceContributionReceiptProvider } from "../domain/ports/marketplace-refund-contribution-journal.port.js";
import { buildMarketplaceRefundContributionCertificate, marketplaceContributionHash, marketplaceContributionMetadata, validMarketplaceRefundContributionRequest } from "../domain/services/marketplace-refund-contribution.js";
import { marketplaceCaptureAccount } from "./marketplace-capture-account.js";

const id = (value: unknown): string | undefined => typeof value === "string" ? value : value && typeof value === "object" && "id" in value && typeof value.id === "string" ? value.id : undefined;
/** This adapter only reads separately authorised payments. It cannot create,
 * confirm, debit, refund or modify a Stripe object. */
export class MarketplaceRefundContributionAdapter implements MarketplaceContributionReceiptProvider {
  private readonly stripe?: Stripe;
  constructor(private readonly config: { stripeSecret?: string }, request: typeof fetch = globalThis.fetch) {
    if (config.stripeSecret) this.stripe = new Stripe(config.stripeSecret, { apiVersion: "2026-04-22.dahlia",
      httpClient: Stripe.createFetchHttpClient(request), maxNetworkRetries: 0, timeout: 15_000 });
  }
  private account(scope: MarketplaceContributionCustomerScope): boolean {
    return !!this.stripe && marketplaceCaptureAccount("stripe", scope.environment, this.config.stripeSecret).accountFingerprint === scope.accountFingerprint;
  }
  async readCustomerBinding(scope: MarketplaceContributionCustomerScope): Promise<MarketplaceContributionCustomerProof | undefined> {
    try {
      if (!scope.merchantId?.trim() || !/^cus_[A-Za-z0-9_]+$/.test(scope.customerId) || !this.account(scope)) return undefined;
      const customer = await this.stripe!.customers.retrieve(scope.customerId);
      if (customer.id !== scope.customerId || customer.object !== "customer" || "deleted" in customer && customer.deleted ||
        !("livemode" in customer) || customer.livemode !== (scope.environment === "live") ||
        customer.metadata?.merchant_id !== scope.merchantId) return undefined;
      return { ...scope, observedAt: new Date().toISOString() };
    } catch { return undefined; }
  }
  async readContribution(request: MarketplaceRefundContributionRequest): Promise<MarketplaceRefundContributionProof | undefined> {
    try {
      if (!validMarketplaceRefundContributionRequest(request) || !this.account(request)) return undefined;
      if (!await this.readCustomerBinding(request)) return undefined;
      const before = await this.snapshot(request);
      const seen = new Set<string>(); let cursor: string | undefined, complete = false;
      for (let pageIndex = 0; pageIndex < 20; pageIndex++) {
        const page = await this.stripe!.refunds.list({ charge: before.charge.id, limit: 100, ...(cursor ? { starting_after: cursor } : {}) });
        if (page.object !== "list" || !Array.isArray(page.data) || typeof page.has_more !== "boolean" || page.has_more && !page.data.length) return undefined;
        for (const listed of page.data) {
          if (!/^re_[A-Za-z0-9_]+$/.test(listed.id) || seen.has(listed.id)) return undefined;
          seen.add(listed.id);
          const refund = await this.stripe!.refunds.retrieve(listed.id);
          if (refund.id !== listed.id || refund.object !== "refund" || refund.amount !== listed.amount ||
            id(refund.charge) !== before.charge.id || id(refund.payment_intent) !== request.providerPaymentIntentId) return undefined;
        }
        if (!page.has_more) { complete = true; break; }
        cursor = page.data.at(-1)!.id;
      }
      if (!complete || seen.size) return undefined; // Pending, failed and cancelled refund attempts are also fenced.
      const after = await this.snapshot(request);
      if (marketplaceContributionHash(before) !== marketplaceContributionHash(after) || !await this.readCustomerBinding(request)) return undefined;
      const proof: MarketplaceRefundContributionProof = { request: structuredClone(request), provider: "stripe",
        accountFingerprint: marketplaceCaptureAccount("stripe", request.environment, this.config.stripeSecret).accountFingerprint,
        observedAt: new Date().toISOString(), ...after };
      return buildMarketplaceRefundContributionCertificate(request, proof) ? proof : undefined;
    } catch { return undefined; }
  }
  private async snapshot(request: MarketplaceRefundContributionRequest) {
    const pi = await this.stripe!.paymentIntents.retrieve(request.providerPaymentIntentId);
    const metadata = marketplaceContributionMetadata(request);
    if (pi.object !== "payment_intent" || pi.id !== request.providerPaymentIntentId ||
      pi.status !== "succeeded" || pi.amount !== request.grossAmountCents || pi.amount_received !== request.grossAmountCents || id(pi.customer) !== request.customerId ||
      marketplaceContributionHash(pi.metadata) !== marketplaceContributionHash(metadata) ||
      pi.payment_method_types.length !== 1 || pi.payment_method_types[0] !== "card" || pi.automatic_payment_methods?.enabled ||
      pi.application_fee_amount !== null || pi.on_behalf_of !== null || pi.transfer_data !== null ||
      pi.currency !== "brl" || pi.livemode !== (request.environment === "live")) throw Error("payment");
    const chargeId = id(pi.latest_charge);
    if (!/^ch_[A-Za-z0-9_]+$/.test(chargeId ?? "")) throw Error("charge");
    const ch = await this.stripe!.charges.retrieve(chargeId!);
    if (ch.object !== "charge" || ch.id !== chargeId || ch.amount_captured !== request.grossAmountCents || ch.amount !== request.grossAmountCents ||
      id(ch.payment_intent) !== pi.id || id(ch.customer) !== request.customerId || ch.status !== "succeeded" || !ch.paid || !ch.captured || ch.disputed || ch.amount_refunded !== 0 ||
      ch.payment_method_details?.type !== "card" || ch.transfer_data || ch.transfer || ch.application_fee || ch.application_fee_amount !== null || ch.on_behalf_of ||
      ch.currency !== "brl" || ch.livemode !== (request.environment === "live")) throw Error("charge");
    const balanceId = id(ch.balance_transaction);
    if (!/^txn_[A-Za-z0-9_]+$/.test(balanceId ?? "")) throw Error("balance");
    const bt = await this.stripe!.balanceTransactions.retrieve(balanceId!);
    if (bt.object !== "balance_transaction" || bt.id !== balanceId || bt.currency !== "brl" || bt.exchange_rate !== null ||
      id(bt.source) !== ch.id || bt.type !== "charge" || bt.status !== "available" || !Number.isSafeInteger(bt.available_on) ||
      bt.available_on <= 0 || bt.available_on * 1000 > Date.now() + 60_000) throw Error("balance");
    return {
      paymentIntent: { id: pi.id, status: pi.status, amountCents: pi.amount, receivedAmountCents: pi.amount_received,
        currency: "BRL" as const, environment: request.environment, customerId: request.customerId, latestChargeId: ch.id,
        applicationFeeCents: null, onBehalfOf: null, transferDestination: null, metadata },
      charge: { id: ch.id, paymentIntentId: pi.id, customerId: request.customerId, amountCents: ch.amount,
        paymentMethodType: "card" as const, currency: "BRL" as const, environment: request.environment,
        status: ch.status, paid: true as const, captured: true as const, disputed: false as const, refundedAmountCents: 0 as const,
        refundsComplete: true as const, refundIds: [] as string[], balanceTransactionId: bt.id,
        transferId: null, applicationFeeCents: null },
      balance: { id: bt.id, sourceId: ch.id, type: bt.type, status: bt.status, currency: "BRL" as const,
        amountCents: bt.amount, feeCents: bt.fee, netCents: bt.net },
    } satisfies Omit<MarketplaceRefundContributionProof, "request" | "provider" | "accountFingerprint" | "observedAt">;
  }
}
