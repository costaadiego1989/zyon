import Stripe from "stripe";
import type { MarketplaceNativeRecoveryProvider, MarketplaceNativeRecoveryRequest, MarketplaceNativeRecoveryProof, MarketplaceNativeReversalReceipt } from "../domain/ports/marketplace-native-recovery.port.js";
import { validNativeRecoveryRequest, validNativeRecoveryProof } from "../domain/services/marketplace-native-recovery-evidence.js";
import { marketplaceCaptureAccount } from "./marketplace-capture-account.js";

const id = (value: unknown): string | undefined => typeof value === "string" ? value : value && typeof value === "object" && "id" in value && typeof value.id === "string" ? value.id : undefined;
/** Only Stripe GET endpoints; both ends must match the frozen refund history. */
export class MarketplaceNativeRecoveryAdapter implements MarketplaceNativeRecoveryProvider {
  private readonly stripe?: Stripe;
  constructor(private readonly config: { stripeSecret?: string }, request: typeof fetch = globalThis.fetch) {
    if (config.stripeSecret) this.stripe = new Stripe(config.stripeSecret, { apiVersion: "2026-04-22.dahlia",
      httpClient: Stripe.createFetchHttpClient(request), maxNetworkRetries: 0, timeout: 15_000 });
  }
  async reconcile(input: MarketplaceNativeRecoveryRequest): Promise<MarketplaceNativeRecoveryProof | undefined> {
    try {
      if (!validNativeRecoveryRequest(input) || !this.stripe || marketplaceCaptureAccount("stripe", input.environment, this.config.stripeSecret).accountFingerprint !== input.target.accountFingerprint) return undefined;
      await this.payment(input);
      const initial = await this.transfer(input);
      const receipts: MarketplaceNativeReversalReceipt[] = [], seen = new Set<string>();
      let cursor: string | undefined;
      for (let pageIndex = 0; pageIndex < 20; pageIndex++) {
        const page = await this.stripe.transfers.listReversals(input.target.providerTransferId, { limit: 100, ...(cursor ? { starting_after: cursor } : {}) });
        if (page.object !== "list" || !Array.isArray(page.data) || typeof page.has_more !== "boolean" || page.has_more && !page.data.length) return undefined;
        for (const listed of page.data) {
          if (!/^trr_[A-Za-z0-9_]+$/.test(listed.id) || seen.has(listed.id)) return undefined;
          seen.add(listed.id);
          const row = await this.stripe.transfers.retrieveReversal(input.target.providerTransferId, listed.id);
          if (row.id !== listed.id || row.object !== "transfer_reversal" || row.amount !== listed.amount || row.currency !== "brl" ||
            id(row.transfer) !== input.target.providerTransferId || row.source_refund !== null || !/^txn_[A-Za-z0-9_]+$/.test(id(row.balance_transaction) ?? "")) return undefined;
          const known = input.knownReversals.find(value => value.providerOperationId === row.id);
          if (known && (row.amount !== known.amountCents || row.metadata?.marketplace_reference !== known.reference ||
            row.metadata?.marketplace_request_hash !== known.requestHash || row.metadata?.payment_intent_id !== input.target.providerPaymentId ||
            row.metadata?.marketplace_operation !== "transfer_reversal")) return undefined;
          // An unknown receipt carrying application metadata may belong to a lost internal claim.
          if (!known && Object.keys(row.metadata ?? {}).some(key => key.startsWith("marketplace_") || key === "payment_intent_id")) return undefined;
          const balance = await this.stripe.balanceTransactions.retrieve(id(row.balance_transaction)!);
          if (balance.id !== id(row.balance_transaction) || balance.object !== "balance_transaction" || id(balance.source) !== row.id ||
            balance.type !== "transfer_refund" || balance.status !== "available" || balance.currency !== "brl" || balance.amount !== row.amount ||
            balance.net !== row.amount || balance.fee !== 0 || balance.exchange_rate !== null) return undefined;
          receipts.push({ providerOperationId: row.id, providerTransferId: input.target.providerTransferId, amountCents: row.amount,
            currency: "BRL", sourceRefund: null, balanceTransactionId: balance.id, balanceSourceId: row.id, balanceType: "transfer_refund",
            balanceStatus: "available", balanceAmountCents: balance.amount, balanceNetCents: balance.net, balanceFeeCents: 0 });
        }
        if (!page.has_more) break;
        if (pageIndex === 19) return undefined;
        cursor = page.data[page.data.length - 1]!.id;
      }
      const final = await this.transfer(input);
      if (initial.amount_reversed !== final.amount_reversed || receipts.reduce((sum, row) => sum + row.amountCents, 0) !== final.amount_reversed) return undefined;
      await this.payment(input);
      const proof: MarketplaceNativeRecoveryProof = { request: input, observedAt: new Date().toISOString(),
        refundedAmountCents: input.version === 1 ? 0 : input.refunds.reduce((sum, row) => sum + row.amountCents, 0),
        buyerRefundIds: input.version === 1 ? [] : input.refunds.map(row => row.providerOperationId), providerReversedAmountCents: final.amount_reversed,
        receipts: receipts.sort((a, b) => a.providerOperationId < b.providerOperationId ? -1 : a.providerOperationId > b.providerOperationId ? 1 : 0) };
      return validNativeRecoveryProof(input, proof) ? proof : undefined;
    } catch { return undefined; }
  }
  private async payment(input: MarketplaceNativeRecoveryRequest) {
    const payment = await this.stripe!.paymentIntents.retrieve(input.target.providerPaymentId);
    if (payment.id !== input.target.providerPaymentId || payment.status !== "succeeded" || payment.amount !== input.paymentAmountCents ||
      payment.amount_received !== input.paymentAmountCents || payment.currency !== "brl" || payment.livemode !== (input.environment === "live") ||
      id(payment.latest_charge) !== input.sourceId || payment.transfer_data || payment.application_fee_amount || payment.on_behalf_of) throw Error("payment");
    const charge = await this.stripe!.charges.retrieve(input.sourceId);
    if (charge.id !== input.sourceId || id(charge.payment_intent) !== input.target.providerPaymentId || charge.amount !== input.paymentAmountCents ||
      charge.amount_captured !== input.paymentAmountCents ||
      charge.amount_refunded !== (input.version === 1 ? 0 : input.refunds.reduce((sum, row) => sum + row.amountCents, 0)) ||
      charge.currency !== "brl" || !charge.paid || !charge.captured ||
      charge.livemode !== (input.environment === "live") || charge.transfer_data || charge.application_fee || charge.application_fee_amount || charge.on_behalf_of || charge.transfer) throw Error("charge");
    if (input.version === 1) {
      const refunds = await this.stripe!.refunds.list({ charge: input.sourceId, limit: 100 });
      if (refunds.object !== "list" || refunds.has_more !== false || !Array.isArray(refunds.data) || refunds.data.length !== 0) throw Error("buyer_refund");
    } else {
      const remaining = new Map(input.refunds.map(row => [row.providerOperationId, row])), seen = new Set<string>();
      let cursor: string | undefined, total = 0;
      for (let pageIndex = 0; pageIndex < 20; pageIndex++) {
        const page = await this.stripe!.refunds.list({ charge: input.sourceId, limit: 100, ...(cursor ? { starting_after: cursor } : {}) });
        if (page.object !== "list" || !Array.isArray(page.data) || typeof page.has_more !== "boolean" || page.has_more && !page.data.length) throw Error("buyer_refund");
        for (const listed of page.data) {
          const known = remaining.get(listed.id);
          if (!known || seen.has(listed.id)) throw Error("buyer_refund");
          seen.add(listed.id);
          const row = await this.stripe!.refunds.retrieve(listed.id);
          if (row.id !== listed.id || row.object !== "refund" || row.status !== "succeeded" || row.amount !== known.amountCents ||
            listed.amount !== row.amount || row.currency !== "brl" || id(row.charge) !== input.sourceId ||
            id(row.payment_intent) !== input.target.providerPaymentId || row.transfer_reversal || row.source_transfer_reversal || row.metadata?.marketplace_reference !== known.reference ||
            row.metadata?.marketplace_request_hash !== known.requestHash || row.metadata?.payment_intent_id !== input.target.providerPaymentId ||
            row.metadata?.marketplace_operation !== "refund") throw Error("buyer_refund");
          remaining.delete(row.id); total += row.amount;
        }
        if (!page.has_more) break;
        if (pageIndex === 19) throw Error("buyer_refund");
        cursor = page.data[page.data.length - 1]!.id;
      }
      if (remaining.size || total !== charge.amount_refunded) throw Error("buyer_refund");
    }
  }
  private async transfer(input: MarketplaceNativeRecoveryRequest) {
    const transfer = await this.stripe!.transfers.retrieve(input.target.providerTransferId);
    if (transfer.id !== input.target.providerTransferId || transfer.object !== "transfer" || id(transfer.destination) !== input.target.destination ||
      id(transfer.source_transaction) !== input.sourceId || transfer.amount !== input.target.amountCents || transfer.currency !== "brl" ||
      transfer.livemode !== (input.environment === "live") || transfer.transfer_group !== input.target.reference ||
      transfer.metadata?.marketplace_reference !== input.target.reference || transfer.metadata?.payment_intent_id !== input.target.providerPaymentId ||
      input.version === 2 && (transfer.metadata?.marketplace_operation !== "residual_payout" || transfer.metadata?.marketplace_request_hash !== input.target.requestHash) ||
      !Number.isSafeInteger(transfer.amount_reversed) || transfer.amount_reversed < 0 || transfer.amount_reversed > transfer.amount ||
      transfer.reversed !== (transfer.amount_reversed === transfer.amount)) throw Error("transfer");
    return transfer;
  }
}
