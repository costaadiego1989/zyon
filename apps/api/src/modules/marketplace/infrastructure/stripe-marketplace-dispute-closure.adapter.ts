import Stripe from "stripe";
import type { MarketplaceDisputeBalanceEntry, MarketplaceDisputeClosureProof, MarketplaceDisputeClosureProvider, MarketplaceDisputeClosureRequest } from "../domain/ports/marketplace-dispute-closure.port.js";
import { assertMarketplaceDisputeClosureProof, assertMarketplaceDisputeClosureRequest } from "../domain/services/marketplace-dispute-closure-evidence.js";
import { marketplaceCaptureAccount } from "./marketplace-capture-account.js";
import { fundingHash } from "./repositories/prisma-marketplace-funding.repository.js";

const id = (value: any): string | undefined => typeof value === "string" ? value : value?.id;

/** Only observes one full BRL card dispute and its account ledger, on the
 * original platform account. No provider mutation or monetary settlement. */
export class StripeMarketplaceDisputeClosureAdapter implements MarketplaceDisputeClosureProvider {
  private readonly stripe?: Stripe;
  constructor(private readonly config: { stripeSecret?: string }, request: typeof fetch = globalThis.fetch) {
    if (config.stripeSecret) this.stripe = new Stripe(config.stripeSecret, { apiVersion: "2026-04-22.dahlia",
      httpClient: Stripe.createFetchHttpClient(request), timeout: 15_000, maxNetworkRetries: 0 });
  }

  async read(request: MarketplaceDisputeClosureRequest): Promise<MarketplaceDisputeClosureProof | null> {
    assertMarketplaceDisputeClosureRequest(request);
    const account = marketplaceCaptureAccount("stripe", request.environment, this.config.stripeSecret);
    if (account.accountFingerprint !== request.accountFingerprint) throw Error("marketplace_dispute_closure_account_mismatch");
    const beforePayment = await this.payment(request);
    if (!beforePayment) return null;
    const beforeDispute = await this.dispute(request);
    if (!beforeDispute) return null;
    const listed = await this.balanceHistory(request);
    if (!listed || !this.sameIds(beforeDispute.balance_transactions, listed)) return null;
    const entries: MarketplaceDisputeBalanceEntry[] = [];
    for (const row of [...listed].sort((a, b) => a.id.localeCompare(b.id))) {
      const exact = await this.stripe!.balanceTransactions.retrieve(row.id);
      const normalized = this.entry(request, exact);
      if (!normalized || fundingHash(normalized) !== fundingHash(this.entry(request, row))) return null;
      entries.push(normalized);
    }
    // Two independent histories protect against a new adjustment, status change,
    // refund, or malformed pagination arriving while the reads were in progress.
    const afterHistory = await this.balanceHistory(request);
    const afterDispute = await this.dispute(request);
    if (!afterHistory || !afterDispute || afterDispute.status !== beforeDispute.status ||
        !this.sameIds(afterDispute.balance_transactions, afterHistory) ||
        fundingHash(afterHistory.map(row => this.entry(request, row)).sort((a, b) => (a?.balanceTransactionId ?? "").localeCompare(b?.balanceTransactionId ?? ""))) !== fundingHash(entries) ||
        !await this.payment(request)) return null;
    const proof: MarketplaceDisputeClosureProof = { version: 1, requestHash: request.requestHash, provider: "stripe",
      environment: request.environment, accountFingerprint: request.accountFingerprint, providerPaymentId: request.providerPaymentId,
      sourceId: request.sourceId, providerDisputeId: request.providerDisputeId, status: beforeDispute.status as "won" | "lost",
      amountCents: request.amountCents, currency: "BRL", entries,
      principalWithdrawnCents: entries.filter(row => row.kind === "principal_withdrawal").reduce((sum, row) => sum - row.amountCents, 0),
      principalReinstatedCents: entries.filter(row => row.kind === "principal_reinstatement").reduce((sum, row) => sum + row.amountCents, 0),
      providerFeeCents: entries.reduce((sum, row) => sum + row.feeCents, 0),
      balanceDeltaCents: entries.reduce((sum, row) => sum + row.netCents, 0), observedAt: new Date().toISOString() };
    try { assertMarketplaceDisputeClosureProof(request, proof); } catch { return null; }
    return proof;
  }

  private async payment(request: MarketplaceDisputeClosureRequest): Promise<boolean> {
    const payment = await this.stripe!.paymentIntents.retrieve(request.providerPaymentId);
    if (payment.id !== request.providerPaymentId || payment.object !== "payment_intent" || payment.status !== "succeeded" ||
        payment.amount !== request.amountCents || payment.amount_received !== request.amountCents || payment.amount_capturable !== 0 ||
        payment.currency !== "brl" || payment.livemode !== (request.environment === "live") || id(payment.latest_charge) !== request.sourceId ||
        payment.transfer_data || payment.application_fee_amount || payment.on_behalf_of ||
        payment.metadata?.merchant_id !== request.hostMerchantId || payment.metadata?.intent_id !== request.paymentIntentId ||
        payment.metadata?.session_id !== request.checkoutSessionId) return false;
    const charge = await this.stripe!.charges.retrieve(request.sourceId);
    if (charge.id !== request.sourceId || charge.object !== "charge" || id(charge.payment_intent) !== request.providerPaymentId ||
        charge.amount !== request.amountCents || charge.amount_captured !== request.amountCents || charge.currency !== "brl" ||
        charge.livemode !== (request.environment === "live") || charge.captured !== true || charge.paid !== true ||
        charge.refunded !== false || charge.amount_refunded !== 0 || charge.refunds?.object !== "list" ||
        charge.refunds.has_more !== false || !Array.isArray(charge.refunds.data) || charge.refunds.data.length !== 0 ||
        charge.transfer || charge.transfer_data || charge.application_fee || charge.application_fee_amount || charge.on_behalf_of ||
        charge.payment_method_details?.type !== "card" || id(charge.balance_transaction) !== request.captureBalanceTransactionId) return false;
    const capture = await this.stripe!.balanceTransactions.retrieve(request.captureBalanceTransactionId);
    return capture.object === "balance_transaction" && capture.id === request.captureBalanceTransactionId && id(capture.source) === request.sourceId &&
      capture.type === "charge" && capture.status === "available" && capture.currency === "brl" && capture.exchange_rate === null &&
      capture.amount === request.amountCents && capture.fee === request.captureFeeCents && capture.net === request.captureNetCents &&
      capture.amount - capture.fee === capture.net;
  }

  private async dispute(request: MarketplaceDisputeClosureRequest) {
    const row = await this.stripe!.disputes.retrieve(request.providerDisputeId);
    if (row.object !== "dispute" || row.id !== request.providerDisputeId || id(row.charge) !== request.sourceId ||
        id(row.payment_intent) !== request.providerPaymentId || row.amount !== request.amountCents || row.currency !== "brl" ||
        row.livemode !== (request.environment === "live") || !["won", "lost"].includes(row.status) ||
        !Array.isArray(row.balance_transactions) || row.balance_transactions.length !== (row.status === "won" ? 2 : 1) ||
        new Set(row.balance_transactions.map(id)).size !== row.balance_transactions.length ||
        row.balance_transactions.some(balance => !/^txn_[A-Za-z0-9_]+$/.test(id(balance) ?? ""))) return null;
    // Multiple disputes can exist on one charge. A caller-selected single ID
    // cannot hide another case against the same original principal.
    const disputes = await this.stripe!.disputes.list({ charge: request.sourceId, limit: 100 });
    if (disputes.object !== "list" || disputes.has_more !== false || !Array.isArray(disputes.data) ||
        disputes.data.length !== 1 || disputes.data[0]!.id !== row.id) return null;
    return row;
  }

  private async balanceHistory(request: MarketplaceDisputeClosureRequest): Promise<Stripe.BalanceTransaction[] | null> {
    const results: Stripe.BalanceTransaction[] = [], seen = new Set<string>(); let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const rows = await this.stripe!.balanceTransactions.list({ source: request.providerDisputeId, limit: 100,
        ...(cursor ? { starting_after: cursor } : {}) });
      if (rows.object !== "list" || typeof rows.has_more !== "boolean" || !Array.isArray(rows.data) || rows.data.length > 100 ||
          rows.has_more && rows.data.length === 0) return null;
      for (const row of rows.data) {
        if (!/^txn_[A-Za-z0-9_]+$/.test(row.id) || seen.has(row.id) || !this.entry(request, row)) return null;
        seen.add(row.id); results.push(row);
      }
      if (!rows.has_more) return results;
      cursor = rows.data.at(-1)!.id;
    }
    return null;
  }

  private sameIds(disputeEntries: Stripe.BalanceTransaction[], sourceEntries: Stripe.BalanceTransaction[]): boolean {
    return fundingHash(disputeEntries.map(id).sort()) === fundingHash(sourceEntries.map(id).sort());
  }

  private entry(request: MarketplaceDisputeClosureRequest, row: Stripe.BalanceTransaction): MarketplaceDisputeBalanceEntry | null {
    if (!row || row.object !== "balance_transaction" || id(row.source) !== request.providerDisputeId || row.type !== "adjustment" ||
        row.currency !== "brl" || row.exchange_rate !== null || row.status !== "available" ||
        !Number.isSafeInteger(row.amount) || !Number.isSafeInteger(row.fee) || !Number.isSafeInteger(row.net) ||
        row.amount - row.fee !== row.net || !Array.isArray(row.fee_details) || row.fee_details.some(fee => fee.currency !== "brl" ||
          !Number.isSafeInteger(fee.amount) || fee.application != null) || row.fee_details.reduce((sum, fee) => sum + fee.amount, 0) !== row.fee) return null;
    let kind: MarketplaceDisputeBalanceEntry["kind"];
    if (row.reporting_category === "dispute" && row.amount === -request.amountCents && row.fee >= 0) kind = "principal_withdrawal";
    else if (row.reporting_category === "dispute_reversal" && row.amount === request.amountCents && row.fee <= 0) kind = "principal_reinstatement";
    else return null;
    return { balanceTransactionId: row.id, kind, amountCents: row.amount, feeCents: row.fee, netCents: row.net,
      created: row.created, availableOn: row.available_on };
  }
}
