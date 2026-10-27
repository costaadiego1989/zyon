import Stripe from "stripe";
import type { MarketplaceFeeExcessRequest, MarketplaceFeeExcessObservation, MarketplaceFeeExcessProof } from "../domain/ports/marketplace-fee-excess-return.port.js";
import { validMarketplaceFeeExcessRequest, marketplaceFeeExcessMetadata, buildMarketplaceFeeExcessReturn } from "../domain/services/marketplace-fee-excess-return.js";
import { marketplaceContributionHash as hash } from "../domain/services/marketplace-refund-contribution.js";
import { sellerFeeMetadata } from "../domain/services/marketplace-seller-fee-collection.js";
import { hostFeeMetadata } from "../domain/services/marketplace-host-fee-collection.js";
import { MarketplaceRefundContributionAdapter } from "./marketplace-refund-contribution.adapter.js";
import { marketplaceCaptureAccount } from "./marketplace-capture-account.js";

const id = (v: unknown): string | undefined => typeof v === "string" ? v : v && typeof v === "object" && "id" in v && typeof v.id === "string" ? v.id : undefined;
const unknown = (): MarketplaceFeeExcessObservation => ({ state: "unknown" });

/** Submission is invoked only after the repository's single durable claim.
 * Recovery reads only; original purchase funding is never refunded here. */
export class StripeMarketplaceFeeExcessReturnTransport {
  private readonly stripe?: Stripe;
  private readonly customerReader: MarketplaceRefundContributionAdapter;
  constructor(private readonly family: MarketplaceFeeExcessRequest["family"], private readonly config: { stripeSecret?: string }, request: typeof fetch = globalThis.fetch) {
    this.customerReader = new MarketplaceRefundContributionAdapter(config, request);
    if (config.stripeSecret) this.stripe = new Stripe(config.stripeSecret, { apiVersion: "2026-04-22.dahlia",
      httpClient: Stripe.createFetchHttpClient(request), maxNetworkRetries: 0, timeout: 15_000 });
  }
  private admitted(r: MarketplaceFeeExcessRequest): boolean {
    return !!this.stripe && r.family === this.family && validMarketplaceFeeExcessRequest(r) &&
      marketplaceCaptureAccount("stripe", r.credit.request.environment, this.config.stripeSecret).accountFingerprint === r.credit.request.accountFingerprint;
  }
  private async customer(r: MarketplaceFeeExcessRequest): Promise<boolean> {
    return !!await this.customerReader.readCustomerBinding(r.credit.request);
  }
  private async incoming(r: MarketplaceFeeExcessRequest, returned: number) {
    const c = r.credit, q = c.request, frozen = c.proof;
    const pi = await this.stripe!.paymentIntents.retrieve(frozen.paymentIntent.id);
    const metadata = r.family === "seller" ? sellerFeeMetadata(q as Parameters<typeof sellerFeeMetadata>[0]) : hostFeeMetadata(q as Parameters<typeof hostFeeMetadata>[0]);
    if (pi.object !== "payment_intent" || pi.id !== frozen.paymentIntent.id || pi.status !== "succeeded" || pi.amount !== q.grossAmountCents ||
      pi.amount_received !== q.grossAmountCents || pi.amount_capturable !== 0 || id(pi.customer) !== q.customerId || id(pi.latest_charge) !== frozen.charge.id ||
      pi.currency !== "brl" || pi.livemode !== (q.environment === "live") || hash(pi.metadata) !== hash(metadata) ||
      pi.payment_method_types.length !== 1 || pi.payment_method_types[0] !== "card" || pi.automatic_payment_methods?.enabled ||
      pi.application_fee_amount !== null || pi.on_behalf_of !== null || pi.transfer_data !== null || pi.setup_future_usage !== null) throw Error("fee_payment");
    const ch = await this.stripe!.charges.retrieve(frozen.charge.id);
    if (ch.object !== "charge" || ch.id !== frozen.charge.id || id(ch.payment_intent) !== pi.id || id(ch.customer) !== q.customerId ||
      ch.amount !== q.grossAmountCents || ch.amount_captured !== q.grossAmountCents || ch.status !== "succeeded" || ch.paid !== true || ch.captured !== true ||
      ch.disputed !== false || ch.refunded !== false || ch.amount_refunded !== returned || ch.payment_method_details?.type !== "card" ||
      ch.currency !== "brl" || ch.livemode !== (q.environment === "live") || ch.transfer || ch.transfer_data || ch.application_fee ||
      ch.application_fee_amount !== null || ch.on_behalf_of || id(ch.balance_transaction) !== frozen.balance.id) throw Error("fee_charge");
    const b = await this.stripe!.balanceTransactions.retrieve(frozen.balance.id);
    if (b.object !== "balance_transaction" || b.id !== frozen.balance.id || id(b.source) !== ch.id || b.type !== "charge" || b.currency !== "brl" ||
      b.status !== "available" || b.exchange_rate !== null || b.amount !== frozen.balance.amountCents || b.fee !== frozen.balance.feeCents ||
      b.net !== frozen.balance.netCents || !Number.isSafeInteger(b.available_on) || b.available_on <= 0 || b.available_on * 1000 > Date.now() + 60_000) throw Error("fee_balance");
    return { pi, ch, b };
  }
  private async refunds(r: MarketplaceFeeExcessRequest): Promise<Stripe.Refund[] | undefined> {
    const rows: Stripe.Refund[] = [], seen = new Set<string>(); let cursor: string | undefined;
    for (let n = 0; n < 20; n++) {
      const page = await this.stripe!.refunds.list({ charge: r.credit.proof.charge.id, limit: 100, ...(cursor ? { starting_after: cursor } : {}) });
      if (page.object !== "list" || !Array.isArray(page.data) || page.data.length > 100 || typeof page.has_more !== "boolean" || page.has_more && !page.data.length) return;
      for (const listed of page.data) {
        if (!/^re_[A-Za-z0-9_]+$/.test(listed.id) || seen.has(listed.id)) return;
        seen.add(listed.id);
        const refund = await this.stripe!.refunds.retrieve(listed.id);
        if (refund.object !== "refund" || refund.id !== listed.id || refund.amount !== listed.amount ||
          id(refund.charge) !== r.credit.proof.charge.id || id(refund.payment_intent) !== r.credit.proof.paymentIntent.id ||
          refund.currency !== "brl") return;
        rows.push(refund);
      }
      if (!page.has_more) return rows;
      cursor = page.data.at(-1)!.id;
    }
    return;
  }
  async submitExcess(r: MarketplaceFeeExcessRequest): Promise<MarketplaceFeeExcessObservation> {
    try {
      if (!this.admitted(r) || !await this.customer(r)) return unknown();
      const before = await this.incoming(r, 0), first = await this.refunds(r);
      if (!first || first.length) return unknown();
      const after = await this.incoming(r, 0), second = await this.refunds(r);
      if (!second || second.length || hash(before) !== hash(after) || !await this.customer(r)) return unknown();
      const refund = await this.stripe!.refunds.create({ charge: r.credit.proof.charge.id, amount: r.amountCents,
        metadata: marketplaceFeeExcessMetadata(r) }, { idempotencyKey: r.reference });
      // A POST response is never evidence of returned funds, even when succeeded.
      return /^re_[A-Za-z0-9_]+$/.test(refund.id ?? "") ? { state: "pending", providerRefundId: refund.id } : unknown();
    } catch { return unknown(); }
  }
  async observeExcess(r: MarketplaceFeeExcessRequest, providerRefundId?: string): Promise<MarketplaceFeeExcessObservation> {
    try {
      if (!this.admitted(r) || providerRefundId !== undefined && !/^re_[A-Za-z0-9_]+$/.test(providerRefundId) || !await this.customer(r)) return unknown();
      const rows = await this.refunds(r);
      if (!rows || rows.length !== 1) return unknown();
      const refund = rows[0]!;
      if (providerRefundId !== undefined && providerRefundId !== refund.id || !refund.metadata || refund.amount !== r.amountCents ||
          hash(refund.metadata) !== hash(marketplaceFeeExcessMetadata(r)) || !Number.isSafeInteger(refund.created) ||
          refund.created < Math.floor(Date.parse(r.authorisedAt) / 1000) || refund.created * 1000 > Date.now() + 60_000) return unknown();
      if (refund.status === "pending" || refund.status === "requires_action") return { state: "pending", providerRefundId: refund.id };
      if (refund.status === "failed" || refund.status === "canceled") return { state: "failed", providerRefundId: refund.id };
      if (refund.status !== "succeeded" || refund.failure_balance_transaction || refund.failure_reason || refund.transfer_reversal || refund.source_transfer_reversal) return unknown();
      const before = await this.incoming(r, r.amountCents), btId = id(refund.balance_transaction);
      if (!/^txn_[A-Za-z0-9_]+$/.test(btId ?? "")) return unknown();
      const balance = await this.stripe!.balanceTransactions.retrieve(btId!);
      const after = await this.incoming(r, r.amountCents), again = await this.refunds(r);
      const balanceAgain = await this.stripe!.balanceTransactions.retrieve(btId!);
      if (!again || again.length !== 1 || hash(rows) !== hash(again) || hash(before) !== hash(after) || hash(balance) !== hash(balanceAgain) || !await this.customer(r)) return unknown();
      const proof: MarketplaceFeeExcessProof = { requestHash: r.requestHash, accountFingerprint: r.credit.request.accountFingerprint, observedAt: new Date().toISOString(),
        refund: { object: refund.object, id: refund.id, charge: id(refund.charge)!, payment_intent: id(refund.payment_intent)!,
          amount: refund.amount, currency: refund.currency, status: refund.status, created: refund.created,
          balance_transaction: btId!, metadata: structuredClone(refund.metadata) },
        balance: { object: balance.object, id: balance.id, source: id(balance.source)!, type: balance.type, status: balance.status,
          currency: balance.currency, amount: balance.amount, fee: balance.fee, net: balance.net, exchange_rate: balance.exchange_rate, available_on: balance.available_on } };
      const observation: MarketplaceFeeExcessObservation = { state: "confirmed", providerRefundId: refund.id, proof };
      return buildMarketplaceFeeExcessReturn(r, observation) ? observation : unknown();
    } catch { return unknown(); }
  }
}
