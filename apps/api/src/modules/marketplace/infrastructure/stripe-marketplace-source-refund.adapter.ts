import Stripe from "stripe";
import type { MarketplaceRefundObservation, MarketplaceRefundRequest, MarketplaceRefundSubmission } from "../domain/ports/marketplace-refund-provider.port.js";
import type { StripeMarketplaceSourceRefundContext, StripeMarketplaceSourceRefundRequest } from "../domain/ports/marketplace-stripe-source-refund.port.js";
import { buildStripeMarketplaceSourceRefundPlan, buildStripeMarketplaceSourceRefundRequest } from "../domain/services/marketplace-stripe-source-refund.js";
import { marketplaceContributionHash as hash } from "../domain/services/marketplace-refund-contribution.js";
import { MarketplaceRefundContributionAdapter } from "./marketplace-refund-contribution.adapter.js";
import { marketplaceCaptureAccount } from "./marketplace-capture-account.js";
import type { StripeMarketplaceSuccessiveResidualBasis, StripeMarketplaceSuccessiveResidualRequest,
  StripeMarketplaceSuccessiveResidualTransferReceipt } from "../domain/ports/stripe-marketplace-successive-residual.port.js";
import { buildStripeMarketplaceSuccessiveResidualAllocation, stripeSuccessiveResidualMetadata,
  stripeSuccessiveResidualRequests } from "../domain/services/stripe-marketplace-successive-residual.js";

const id = (v: unknown): string | undefined => typeof v === "string" ? v :
  v && typeof v === "object" && "id" in v && typeof v.id === "string" ? v.id : undefined;
const cents = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 2_147_483_647;
class ExistingSourceOperation extends Error {}

/** The buyer is refunded only on the original charge. Reversals recover the
 * exact certified sources of that beneficiary's V4 transfers. No balance-wide
 * fallback, fee credit, new seller charge or uncertain POST retry exists here. */
export class StripeMarketplaceSourceRefundAdapter {
  private readonly stripe?: Stripe;
  private readonly contributions: MarketplaceRefundContributionAdapter;
  constructor(private readonly config: { stripeSecret?: string }, request: typeof fetch = globalThis.fetch) {
    this.contributions = new MarketplaceRefundContributionAdapter(config, request);
    if (config.stripeSecret) this.stripe = new Stripe(config.stripeSecret, { apiVersion: "2026-04-22.dahlia",
      httpClient: Stripe.createFetchHttpClient(request), timeout: 15_000, maxNetworkRetries: 0 });
  }
  private validate(input: MarketplaceRefundRequest): StripeMarketplaceSourceRefundRequest {
    const f = input.stripeSourceFunding;
    if (!this.stripe || !f || input.provider !== "stripe" || input.fundingContributions !== undefined ||
        input.asaasCapture !== undefined || input.asaasWalletReturns !== undefined ||
        marketplaceCaptureAccount("stripe", input.environment, this.config.stripeSecret).accountFingerprint !== input.accountFingerprint) {
      throw Error("marketplace_stripe_source_refund_request_invalid");
    }
    const plan = buildStripeMarketplaceSourceRefundPlan(f.context);
    const target = input.kind === "transfer_reversal" ? f.context.residual.operations.find(o =>
      o.providerTransferId === input.transfer?.providerTransferId) : undefined;
    if (input.kind === "transfer_reversal" && !target || hash(plan) !== hash(f.plan) ||
        hash(input) !== hash(buildStripeMarketplaceSourceRefundRequest(f.context, plan, target?.operationId))) {
      throw Error("marketplace_stripe_source_refund_request_invalid");
    }
    return input as StripeMarketplaceSourceRefundRequest;
  }
  private metadata(input: StripeMarketplaceSourceRefundRequest) {
    const target = input.kind === "transfer_reversal" ? input.stripeSourceFunding.context.residual.operations.find(o =>
      o.providerTransferId === input.transfer!.providerTransferId)! : undefined;
    return { marketplace_reference: input.reference, marketplace_request_hash: input.requestHash,
      payment_intent_id: input.providerPaymentId, marketplace_operation: input.kind,
      marketplace_source_plan_hash: input.stripeSourceFunding.plan.planHash, marketplace_source_id: target?.sourceId ?? "original" };
  }
  private matches(input: StripeMarketplaceSourceRefundRequest, metadata: Stripe.Metadata | null) {
    return Object.entries(this.metadata(input)).every(([k, v]) => metadata?.[k] === v);
  }
  private refundObservation(input: StripeMarketplaceSourceRefundRequest, r: Stripe.Refund): MarketplaceRefundObservation {
    if (!/^re_[A-Za-z0-9_]+$/.test(r.id) || r.object !== "refund" || r.amount !== input.amountCents || r.currency !== "brl" ||
        id(r.charge) !== input.sourceId || id(r.payment_intent) !== input.providerPaymentId || r.transfer_reversal ||
        r.source_transfer_reversal || !this.matches(input, r.metadata)) return { state: "unknown" };
    const state = r.status === "succeeded" ? "confirmed" : ["failed", "canceled"].includes(r.status ?? "") ? "failed" :
      ["pending", "requires_action"].includes(r.status ?? "") ? "pending" : "unknown";
    return { state, providerOperationId: r.id, amountCents: r.amount, observedAt: new Date().toISOString() };
  }
  private reversalObservation(input: StripeMarketplaceSourceRefundRequest, r: Stripe.TransferReversal): MarketplaceRefundObservation {
    if (!/^trr_[A-Za-z0-9_]+$/.test(r.id) || r.object !== "transfer_reversal" || r.amount !== input.amountCents || r.currency !== "brl" ||
        id(r.transfer) !== input.transfer!.providerTransferId || r.source_refund || !id(r.balance_transaction)?.startsWith("txn_") ||
        !this.matches(input, r.metadata)) return { state: "unknown" };
    return { state: "confirmed", providerOperationId: r.id, amountCents: r.amount, observedAt: new Date().toISOString() };
  }
  async submit(untrusted: MarketplaceRefundRequest): Promise<MarketplaceRefundSubmission> {
    let attempted = false;
    try {
      const input = this.validate(structuredClone(untrusted));
      const since = await this.funding(input);
      await this.inventory(input, since);
      await this.funding(input); // Close the source-proof/original-charge race before POST.
      attempted = true;
      const r = input.kind === "refund" ? await this.stripe!.refunds.create({ charge: input.sourceId,
        amount: input.amountCents, reason: "requested_by_customer", metadata: this.metadata(input) }, { idempotencyKey: input.reference }) :
        await this.stripe!.transfers.createReversal(input.transfer!.providerTransferId,
          { amount: input.amountCents, metadata: this.metadata(input) }, { idempotencyKey: input.reference });
      const o = input.kind === "refund" ? this.refundObservation(input, r as Stripe.Refund) :
        this.reversalObservation(input, r as Stripe.TransferReversal);
      return o.state === "unknown" ? o : { ...o, state: "pending" };
    } catch (e) { return { state: attempted || e instanceof ExistingSourceOperation ? "unknown" : "not_submitted" }; }
  }
  async reconcile(untrusted: MarketplaceRefundRequest, providerOperationId?: string): Promise<MarketplaceRefundObservation> {
    try {
      const input = this.validate(structuredClone(untrusted));
      let receipt: Stripe.Refund | Stripe.TransferReversal | undefined;
      if (providerOperationId) {
        if (input.kind === "refund" ? !/^re_[A-Za-z0-9_]+$/.test(providerOperationId) : !/^trr_[A-Za-z0-9_]+$/.test(providerOperationId)) return { state: "unknown" };
        receipt = input.kind === "refund" ? await this.stripe!.refunds.retrieve(providerOperationId) :
          await this.stripe!.transfers.retrieveReversal(input.transfer!.providerTransferId, providerOperationId);
        if (receipt.id !== providerOperationId) return { state: "unknown" };
      } else {
        await this.scan<Stripe.Refund | Stripe.TransferReversal>(cursor => input.kind === "refund" ? this.stripe!.refunds.list({ charge: input.sourceId, limit: 100,
          ...(cursor ? { starting_after: cursor } : {}) }) : this.stripe!.transfers.listReversals(input.transfer!.providerTransferId,
          { limit: 100, ...(cursor ? { starting_after: cursor } : {}) }), row => {
          if (row.metadata?.marketplace_reference === input.reference) { if (receipt) throw Error("duplicate_receipt"); receipt = row; }
        });
      }
      if (!receipt) return { state: "unknown" };
      if (input.kind === "transfer_reversal") {
        // A source change cannot redirect the receipt to another transfer.
        const target = input.stripeSourceFunding.context.residual.operations.find(o => o.providerTransferId === input.transfer!.providerTransferId)!;
        this.assertTransfer(input, target, await this.stripe!.transfers.retrieve(target.providerTransferId));
      }
      const observed = input.kind === "refund" ? this.refundObservation(input, receipt as Stripe.Refund) :
        this.reversalObservation(input, receipt as Stripe.TransferReversal);
      if (observed.state !== "confirmed") return observed;
      try { await this.inventory(input, await this.funding(input, observed.providerOperationId), observed.providerOperationId); }
      catch { return { ...observed, reconciliationRequired: true }; }
      return observed;
    } catch { return { state: "unknown" }; }
  }
  /** GET ONLY. Extensions are the exact new requests reconstructed from a V6
   * cash ledger. They are never accepted by the existing refund/reversal paths. */
  async certifyCompletedRefundForResidual(untrusted: StripeMarketplaceSuccessiveResidualBasis): Promise<
    { state: "unknown" } | { state: "confirmed"; transferReceipts: StripeMarketplaceSuccessiveResidualTransferReceipt[] }> {
    try {
      const basis = structuredClone(untrusted);
      buildStripeMarketplaceSuccessiveResidualAllocation(basis);
      const input = this.validate(buildStripeMarketplaceSourceRefundRequest(basis.sourceRefundFunding.context, basis.sourceRefundFunding.plan));
      const receipt = await this.stripe!.refunds.retrieve(basis.completedRefund.providerOperationId);
      const observed = this.refundObservation(input, receipt);
      if (observed.state !== "confirmed" || observed.providerOperationId !== basis.completedRefund.providerOperationId) return { state: "unknown" };
      const transferReceipts: StripeMarketplaceSuccessiveResidualTransferReceipt[] = [];
      await this.inventory(input, await this.funding(input, receipt.id), receipt.id,
        stripeSuccessiveResidualRequests(basis), transferReceipts, true);
      await this.funding(input, receipt.id);
      return { state: "confirmed", transferReceipts };
    } catch { return { state: "unknown" }; }
  }
  private async funding(input: StripeMarketplaceSourceRefundRequest, receipt?: string) {
    let since = await this.original(input, input.kind === "refund" ? receipt : undefined);
    for (const c of input.stripeSourceFunding.context.residual.basis.fundingContributions.certificates) {
      const fresh = await this.contributions.readContribution(c.request);
      if (!fresh) throw Error("marketplace_stripe_source_refund_contribution_changed");
      const { observedAt: _old, ...before } = c.proof, { observedAt: _new, ...after } = fresh;
      if (hash(before) !== hash(after)) throw Error("marketplace_stripe_source_refund_contribution_changed");
      const charge = await this.stripe!.charges.retrieve(c.proof.charge.id);
      if (!cents(charge.created) || !charge.created) throw Error("invalid_source_created");
      since = Math.min(since, charge.created);
    }
    await this.original(input, input.kind === "refund" ? receipt : undefined);
    return since;
  }
  private priorRequest(c: StripeMarketplaceSourceRefundContext, index: number) {
    const h = c.history[index]!, count = c.residual.basis.refunds.length;
    return buildStripeMarketplaceSourceRefundRequest({ ...c, basis: { ...c.basis, refunds: c.basis.refunds.slice(0, count + index + 1) },
      history: c.history.slice(0, index), refundPlanId: h.refundPlanId, returnId: h.returnId });
  }
  private async original(input: StripeMarketplaceSourceRefundRequest, currentReceipt?: string) {
    const c = input.stripeSourceFunding.context, capture = c.basis.budget.capture;
    const pi = await this.stripe!.paymentIntents.retrieve(capture.providerPaymentId);
    const ch = await this.stripe!.charges.retrieve(capture.sourceId);
    const bt = await this.stripe!.balanceTransactions.retrieve(capture.balanceTransactionId!);
    if (pi.id !== capture.providerPaymentId || pi.status !== "succeeded" || pi.amount !== capture.amountCents || pi.amount_received !== capture.amountCents ||
        pi.currency !== "brl" || pi.livemode !== (capture.environment === "live") || id(pi.latest_charge) !== capture.sourceId ||
        pi.transfer_data || pi.application_fee_amount || pi.on_behalf_of || ch.id !== capture.sourceId || id(ch.payment_intent) !== pi.id ||
        ch.amount !== capture.amountCents || ch.amount_captured !== capture.amountCents || ch.currency !== "brl" || ch.livemode !== pi.livemode ||
        ch.paid !== true || ch.captured !== true || ch.disputed !== false || ch.transfer || ch.transfer_data || ch.application_fee ||
        ch.application_fee_amount || ch.on_behalf_of || id(ch.balance_transaction) !== capture.balanceTransactionId ||
        bt.id !== capture.balanceTransactionId || id(bt.source) !== capture.sourceId || bt.type !== "charge" || bt.status !== "available" ||
        bt.currency !== "brl" || bt.exchange_rate || bt.amount !== capture.amountCents || bt.fee !== capture.providerFeeCents || bt.net !== capture.netAmountCents ||
        !cents(ch.created) || !ch.created) throw Error("marketplace_stripe_source_refund_original_changed");
    const expected = new Map(input.previousRefunds.map(r => [r.providerOperationId, r.amountCents]));
    if (currentReceipt) expected.set(currentReceipt, input.amountCents);
    const seen = new Set<string>(); let total = 0;
    await this.scan(cursor => this.stripe!.refunds.list({ charge: capture.sourceId, limit: 100,
      ...(cursor ? { starting_after: cursor } : {}) }), async row => {
      if (row.metadata?.marketplace_reference === input.reference && row.id !== currentReceipt) throw new ExistingSourceOperation();
      if (["failed", "canceled"].includes(row.status ?? "") && !expected.has(row.id)) return;
      if (row.object !== "refund" || id(row.charge) !== capture.sourceId || id(row.payment_intent) !== pi.id || row.currency !== "brl" ||
          row.status !== "succeeded" || row.transfer_reversal || row.source_transfer_reversal || row.amount !== expected.get(row.id)) throw Error("unexpected_refund");
      const legacy = c.residual.basis.refunds.find(r => r.providerOperationId === row.id);
      const h = c.history.findIndex(r => r.providerOperationId === row.id);
      const request = h >= 0 ? this.priorRequest(c, h) : row.id === currentReceipt ? input : undefined;
      if (legacy ? row.metadata?.marketplace_reference !== `mrefund_${hash([c.basis.hostMerchantId, legacy.returnId])}` ||
          row.metadata?.marketplace_request_hash !== legacy.requestHash || row.metadata?.payment_intent_id !== pi.id || row.metadata?.marketplace_operation !== "refund" :
          !request || !this.matches(request, row.metadata)) throw Error("refund_binding_changed");
      await this.assertBalance(row.balance_transaction, row.id, -row.amount, "refund");
      seen.add(row.id); expected.delete(row.id); total += row.amount;
    });
    if (expected.size || ch.amount_refunded !== total || total > capture.amountCents || !currentReceipt && capture.amountCents - total < input.stripeSourceFunding.plan.amountCents) {
      throw Error("marketplace_stripe_source_refund_original_history_changed");
    }
    return ch.created;
  }
  private assertTransfer(input: StripeMarketplaceSourceRefundRequest,
    o: StripeMarketplaceSourceRefundContext["residual"]["operations"][number], row: Stripe.Transfer) {
    const source = input.stripeSourceFunding.context.residual.allocation.sources.find(s => s.sourceId === o.sourceId)!;
    if (row.id !== o.providerTransferId || row.object !== "transfer" || row.amount !== o.request.amountCents || row.currency !== "brl" ||
        row.livemode !== (input.environment === "live") || id(row.source_transaction) !== source.chargeId || id(row.destination) !== o.request.destination ||
        row.transfer_group !== o.request.reference || row.metadata?.marketplace_reference !== o.request.reference ||
        row.metadata?.marketplace_request_hash !== o.request.requestHash || row.metadata?.payment_intent_id !== input.providerPaymentId ||
        row.metadata?.marketplace_operation !== "residual_payout" || row.metadata?.marketplace_source_id !== source.sourceId ||
        !id(row.balance_transaction)?.startsWith("txn_") || !cents(row.amount_reversed) || row.amount_reversed > row.amount ||
        row.reversed !== (row.amount_reversed === row.amount)) throw Error("marketplace_stripe_source_refund_transfer_changed");
  }
  private async inventory(input: StripeMarketplaceSourceRefundRequest, since: number, receipt?: string,
    successors: StripeMarketplaceSuccessiveResidualRequest[] = [], successorReceipts: StripeMarketplaceSuccessiveResidualTransferReceipt[] = [],
    certifyOldDebits = false) {
    const c = input.stripeSourceFunding.context, seen = new Set<string>(), seenReversals = new Set<string>(), seenSuccessors = new Set<string>();
    await this.scan(cursor => this.stripe!.transfers.list({ created: { gte: since }, limit: 100,
      ...(cursor ? { starting_after: cursor } : {}) }), async row => {
      if (!c.residual.allocation.sources.some(s => s.chargeId === id(row.source_transaction))) return;
      const o = c.residual.operations.find(o => o.providerTransferId === row.id);
      if (!o) {
        const expected = successors.find(r => r.reference === row.transfer_group);
        const source = expected?.stripeSuccessiveFunding.allocation.sources.find(s => s.sourceId === expected.sourceId);
        if (!expected || !source || seenSuccessors.has(expected.requestHash) || !/^tr_[A-Za-z0-9_]+$/.test(row.id) || row.object !== "transfer" || row.amount !== expected.amountCents ||
            row.currency !== "brl" || row.livemode !== (input.environment === "live") || id(row.source_transaction) !== source.chargeId ||
            id(row.destination) !== expected.destination || row.amount_reversed !== 0 || row.reversed !== false ||
            !Object.entries(stripeSuccessiveResidualMetadata(expected)).every(([k, v]) => row.metadata?.[k] === v)) throw Error("unexpected_source_transfer");
        const balanceId = id(row.balance_transaction);
        if (!/^txn_[A-Za-z0-9_]+$/.test(balanceId ?? "")) throw Error("successive_transfer_balance_missing");
        const balance = await this.stripe!.balanceTransactions.retrieve(balanceId!);
        if (balance.id !== balanceId || balance.object !== "balance_transaction" || id(balance.source) !== row.id || balance.type !== "transfer" ||
            balance.status !== "available" || balance.currency !== "brl" || balance.exchange_rate || balance.amount !== -row.amount ||
            balance.net !== -row.amount || balance.fee !== 0) throw Error("successive_transfer_balance_unproven");
        let reversals = 0;
        await this.scan(cursor => this.stripe!.transfers.listReversals(row.id, { limit: 100, ...(cursor ? { starting_after: cursor } : {}) }), () => { reversals++; });
        if (reversals) throw Error("unexpected_successive_reversal");
        seenSuccessors.add(expected.requestHash);
        successorReceipts.push({ sourceId: expected.sourceId, merchantId: expected.beneficiaryMerchantId, reference: expected.reference,
          requestHash: expected.requestHash, providerTransferId: row.id, chargeId: source.chargeId, destination: expected.destination, amountCents: row.amount,
          balance: { id: balance.id, sourceId: row.id, type: "transfer", currency: "BRL", status: "available", amountCents: balance.amount, feeCents: 0, netCents: balance.net } });
        return;
      }
      this.assertTransfer(input, o, row); seen.add(o.operationId);
      if (certifyOldDebits) {
        const nativeBalanceId = id(row.balance_transaction), balance = await this.stripe!.balanceTransactions.retrieve(nativeBalanceId!);
        if (!/^txn_[A-Za-z0-9_]+$/.test(nativeBalanceId ?? "") || balance.id !== nativeBalanceId || balance.object !== "balance_transaction" ||
          id(balance.source) !== row.id || balance.type !== "transfer" || balance.status !== "available" || balance.currency !== "brl" ||
          balance.exchange_rate || balance.amount !== -row.amount || balance.net !== -row.amount || balance.fee !== 0) throw Error("previous_transfer_debit_unproven");
      }
      const expected = new Map(c.history.flatMap(h => h.reversals.filter(r => r.payoutId === o.operationId).map(r => ({ ...r, planHash: h.planHash })))
        .map(r => [r.providerOperationId, r]));
      const current = input.stripeSourceFunding.plan.requiredReversals.find(r => r.payoutId === o.operationId);
      const currentRequest = current && buildStripeMarketplaceSourceRefundRequest(c, input.stripeSourceFunding.plan, o.operationId);
      let total = 0, foundCurrent = false;
      await this.scan(cursor => this.stripe!.transfers.listReversals(o.providerTransferId,
        { limit: 100, ...(cursor ? { starting_after: cursor } : {}) }), async reversal => {
        if (seenReversals.has(reversal.id)) throw Error("duplicate_reversal_receipt"); seenReversals.add(reversal.id);
        const prior = expected.get(reversal.id);
        if (prior) {
          if (reversal.metadata?.marketplace_reference !== prior.reference || reversal.metadata?.marketplace_request_hash !== prior.requestHash ||
              reversal.metadata?.payment_intent_id !== input.providerPaymentId || reversal.metadata?.marketplace_operation !== "transfer_reversal" ||
              reversal.metadata?.marketplace_source_id !== o.sourceId || reversal.metadata?.marketplace_source_plan_hash !== prior.planHash ||
              reversal.amount !== prior.amountCents) throw Error("reversal_binding_changed");
          expected.delete(reversal.id);
        } else {
          if (!currentRequest || foundCurrent || this.reversalObservation(currentRequest, reversal).state !== "confirmed") throw Error("unexpected_reversal");
          if (input.kind === "transfer_reversal" && input.transfer!.providerTransferId === o.providerTransferId && reversal.id !== receipt) throw new ExistingSourceOperation();
          foundCurrent = true;
        }
        if (!/^trr_[A-Za-z0-9_]+$/.test(reversal.id) || reversal.object !== "transfer_reversal" || id(reversal.transfer) !== o.providerTransferId ||
            reversal.currency !== "brl" || reversal.source_refund || !cents(reversal.amount) || !reversal.amount) throw Error("reversal_receipt_invalid");
        await this.assertBalance(reversal.balance_transaction, reversal.id, reversal.amount, "transfer_refund");
        total += reversal.amount;
      });
      if (expected.size || total !== row.amount_reversed || input.kind === "refund" && current && !foundCurrent ||
          input.kind === "transfer_reversal" && receipt && input.transfer!.providerTransferId === o.providerTransferId && !foundCurrent) throw Error("source_reversal_incomplete");
    });
    if (seen.size !== c.residual.operations.length) throw Error("source_transfer_inventory_incomplete");
  }
  private async assertBalance(value: unknown, source: string, amount: number, type: "refund" | "transfer_refund") {
    const reference = id(value);
    if (!/^txn_[A-Za-z0-9_]+$/.test(reference ?? "")) throw Error("balance_receipt_missing");
    const bt = await this.stripe!.balanceTransactions.retrieve(reference!);
    // Unexpected fees are an exposure, never an allowance from another source.
    if (bt.id !== reference || bt.object !== "balance_transaction" || id(bt.source) !== source || bt.type !== type ||
        bt.currency !== "brl" || bt.status !== "available" || bt.exchange_rate || bt.amount !== amount || bt.fee !== 0 || bt.net !== amount) {
      throw Error("marketplace_stripe_source_refund_balance_unproven");
    }
  }
  private async scan<T extends { id: string }>(read: (cursor?: string) => Promise<{ data: T[]; has_more: boolean }>,
    inspect: (row: T) => void | Promise<void>) {
    const seen = new Set<string>(); let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const result = await read(cursor);
      if (!Array.isArray(result.data) || result.data.length > 100 || typeof result.has_more !== "boolean") break;
      for (const row of result.data) { if (!row?.id || seen.has(row.id)) throw Error("source_history_duplicate"); seen.add(row.id); await inspect(row); }
      if (!result.has_more) return;
      if (!result.data.length) break; cursor = result.data.at(-1)!.id;
    }
    throw Error("marketplace_stripe_source_refund_history_incomplete");
  }
}
