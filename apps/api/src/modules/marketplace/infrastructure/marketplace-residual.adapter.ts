import Stripe from "stripe";
import type { MarketplaceResidualObservation, MarketplaceResidualProvider, MarketplaceResidualRequest } from "../domain/ports/marketplace-residual-provider.port.js";
import { marketplaceCaptureAccount } from "./marketplace-capture-account.js";
import { fundingHash } from "./repositories/prisma-marketplace-funding.repository.js";
import { StripeMarketplaceResidualSourcesAdapter } from "./stripe-marketplace-residual-sources.adapter.js";
import type { AsaasMarketplaceResidualProvider, AsaasMarketplaceResidualRequest } from "../domain/ports/asaas-marketplace-residual.port.js";
import type { AsaasMarketplaceHostRetentionOutboundRequest } from "../domain/ports/asaas-marketplace-host-retention.port.js";
import { StripeMarketplaceSuccessiveResidualAdapter } from "./stripe-marketplace-successive-residual.adapter.js";
import type { StripeMarketplaceSuccessiveResidualRequest } from "../domain/ports/stripe-marketplace-successive-residual.port.js";

const id = (value: unknown): string | undefined => typeof value === "string" ? value :
  value && typeof value === "object" && "id" in value && typeof value.id === "string" ? value.id : undefined;
const cents = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 2_147_483_647;
class ExistingResidualTransfer extends Error {}

/** Stripe partial-refund path; ordinary payout capture validation remains stricter. */
export class MarketplaceResidualAdapter implements MarketplaceResidualProvider {
  private readonly stripe?: Stripe;
  private readonly sources: StripeMarketplaceResidualSourcesAdapter;
  private readonly successive: StripeMarketplaceSuccessiveResidualAdapter;
  constructor(private readonly config: { stripeSecret?: string }, request: typeof fetch = globalThis.fetch,
    private readonly asaas?: AsaasMarketplaceResidualProvider) {
    this.sources = new StripeMarketplaceResidualSourcesAdapter(config, request);
    this.successive = new StripeMarketplaceSuccessiveResidualAdapter(config, request);
    if (config.stripeSecret) this.stripe = new Stripe(config.stripeSecret, { apiVersion: "2026-04-22.dahlia",
      httpClient: Stripe.createFetchHttpClient(request), timeout: 15_000, maxNetworkRetries: 0 });
  }

  private validate(input: MarketplaceResidualRequest) {
    const { requestHash, ...raw } = input;
    if (input.provider !== "stripe" || input.currency !== "BRL" || !input.capture || input.capture.provider !== "stripe" ||
        input.capture.currency !== "BRL" || input.capture.providerPaymentId !== input.providerPaymentId ||
        input.capture.accountFingerprint !== input.accountFingerprint || !/^pi_[A-Za-z0-9_]+$/.test(input.providerPaymentId) ||
        !/^ch_[A-Za-z0-9_]+$/.test(input.capture.sourceId) || !/^txn_[A-Za-z0-9_]+$/.test(input.capture.balanceTransactionId ?? "") ||
        !/^acct_[A-Za-z0-9_]+$/.test(input.destination) || !/^mresidual_[a-f0-9]{64}$/.test(input.reference) ||
        !/^[a-f0-9]{64}$/.test(requestHash) || fundingHash(raw) !== requestHash || !cents(input.amountCents) ||
        !cents(input.remainingTotalCents) || input.amountCents > input.remainingTotalCents ||
        !cents(input.capture.amountCents) || !cents(input.capture.netAmountCents) ||
        !Number.isSafeInteger(input.capture.providerFeeCents) || input.capture.providerFeeCents < 0 ||
        input.capture.amountCents - input.capture.providerFeeCents !== input.capture.netAmountCents ||
        !Array.isArray(input.refunds) || !input.refunds.length || input.refunds.length > 2000 ||
        new Set(input.refunds.map(row => row.providerOperationId)).size !== input.refunds.length ||
        input.refunds.some(row => !/^re_[A-Za-z0-9_]+$/.test(row.providerOperationId) || !cents(row.amountCents)) ||
        input.refunds.reduce((sum, row) => sum + row.amountCents, input.remainingTotalCents) > input.capture.netAmountCents ||
        !Array.isArray(input.transfers) || !input.transfers.length ||
        new Set(input.transfers.map(row => row.reference)).size !== input.transfers.length ||
        new Set(input.transfers.map(row => row.destination)).size !== input.transfers.length ||
        input.transfers.some(row => !/^mresidual_[a-f0-9]{64}$/.test(row.reference) || !/^acct_[A-Za-z0-9_]+$/.test(row.destination) || !cents(row.amountCents)) ||
        input.transfers.reduce((sum, row) => sum + row.amountCents, 0) !== input.remainingTotalCents ||
        !input.transfers.some(row => row.reference === input.reference && row.destination === input.destination && row.amountCents === input.amountCents)) {
      throw new Error("marketplace_residual_request_invalid");
    }
    if (input.version === undefined ? input.originalTransfers !== undefined : ![2, 3].includes(input.version) || !Array.isArray(input.originalTransfers) || !input.originalTransfers.length) {
      throw new Error("marketplace_residual_original_history_invalid");
    }
    if (input.version === 3 ? !Array.isArray(input.previousGenerations) || !input.previousGenerations.length ||
        input.previousGenerations.some((row, index) => !row.residualPlanId || row.generation !== index + 1 ||
          !/^[a-f0-9]{64}$/.test(row.basisHash) || !/^[a-f0-9]{64}$/.test(row.allocationHash)) ||
        new Set(input.previousGenerations.map(row => row.residualPlanId)).size !== input.previousGenerations.length : input.previousGenerations !== undefined) {
      throw new Error("marketplace_residual_generation_history_invalid");
    }
    const original = input.originalTransfers ?? [], reversals = original.flatMap(row => row.reversals ?? []);
    if (new Set(original.map(row => row.payoutId)).size !== original.length ||
        new Set(original.map(row => row.providerTransferId)).size !== original.length ||
        new Set(original.map(row => row.reference)).size !== original.length ||
        new Set(reversals.map(row => row.providerOperationId)).size !== reversals.length ||
        new Set(reversals.map(row => row.reference)).size !== reversals.length || original.some(row =>
          !row.payoutId?.trim() || !row.merchantId?.trim() || !/^tr_[A-Za-z0-9_]+$/.test(row.providerTransferId) ||
          !/^[A-Za-z0-9_:-]{1,200}$/.test(row.reference) || !/^acct_[A-Za-z0-9_]+$/.test(row.destination) ||
          !cents(row.amountCents) || !Array.isArray(row.reversals) || input.transfers.some(t => t.reference === row.reference) ||
          (row.kind === undefined ? row.requestHash !== undefined || row.residualPlanId !== undefined :
            input.version !== 3 || row.kind !== "residual" || !input.previousGenerations?.some(g => g.residualPlanId === row.residualPlanId) ||
            !/^[a-f0-9]{64}$/.test(row.requestHash ?? "") || !/^mresidual_[a-f0-9]{64}$/.test(row.reference)) ||
          row.reversals.reduce((sum, reversal) => sum + reversal.amountCents, 0) > row.amountCents) ||
        reversals.some(row => !/^trr_[A-Za-z0-9_]+$/.test(row.providerOperationId) || !cents(row.amountCents) ||
          !/^[A-Za-z0-9_:-]{1,200}$/.test(row.reference) || !/^[a-f0-9]{64}$/.test(row.requestHash)) ||
        input.version !== 3 && original.reduce((sum, row) => sum + row.amountCents, 0) > input.capture.netAmountCents ||
        original.reduce((sum, row) => sum + row.amountCents - row.reversals.reduce((s, r) => s + r.amountCents, 0), 0) +
          input.refunds.reduce((sum, row) => sum + row.amountCents, input.remainingTotalCents) > input.capture.netAmountCents) {
      throw new Error("marketplace_residual_original_history_invalid");
    }
    const account = marketplaceCaptureAccount("stripe", input.capture.environment, this.config.stripeSecret);
    if (account.accountFingerprint !== input.accountFingerprint) throw new Error("marketplace_residual_account_mismatch");
  }

  async submit(input: MarketplaceResidualRequest) {
    if (input.provider === "asaas" && (input.version === 5 || input.version === 7)) {
      return this.asaas ? this.asaas.submit(input as AsaasMarketplaceResidualRequest | AsaasMarketplaceHostRetentionOutboundRequest) : { state: "not_submitted" as const };
    }
    if (input.version === 6) return this.successive.submit(input as StripeMarketplaceSuccessiveResidualRequest);
    if (input.version === 4) return this.sources.submit(input);
    let attempted = false;
    try {
      this.validate(input);
      // Stripe documents a cumulative source_transaction ceiling. Reversing a
      // transfer is not evidence that this ceiling becomes reusable.
      if ((input.originalTransfers ?? []).reduce((sum, row) => sum + row.amountCents, input.remainingTotalCents) > input.capture.amountCents) {
        throw new Error("marketplace_residual_source_transaction_limit");
      }
      const charge = await this.payment(input);
      if (charge.disputed !== false) throw new Error("marketplace_residual_disputed");
      const capture = input.capture, balance = await this.stripe!.balanceTransactions.retrieve(capture.balanceTransactionId!);
      if (id(charge.balance_transaction) !== capture.balanceTransactionId || balance.id !== capture.balanceTransactionId ||
          id(balance.source) !== capture.sourceId || balance.currency !== "brl" || balance.type !== "charge" || balance.status !== "available" ||
          balance.exchange_rate || balance.amount !== capture.amountCents || balance.fee !== capture.providerFeeCents ||
          balance.net !== capture.netAmountCents) throw new Error("marketplace_residual_capture_changed");
      await this.refundHistory(input, charge.amount_refunded);
      await this.transferHistory(input, charge.created);
      attempted = true;
      const transfer = await this.stripe!.transfers.create({ amount: input.amountCents, currency: "brl", destination: input.destination,
        source_transaction: capture.sourceId, transfer_group: input.reference, metadata: this.metadata(input) }, { idempotencyKey: input.reference });
      const observation = this.observation(input, transfer);
      return observation.state === "unknown" ? observation : { ...observation, state: "pending" as const };
    } catch (error) { return { state: attempted || error instanceof ExistingResidualTransfer ? "unknown" as const : "not_submitted" as const }; }
  }

  async reconcile(input: MarketplaceResidualRequest, providerTransferId?: string): Promise<MarketplaceResidualObservation> {
    if (input.provider === "asaas" && (input.version === 5 || input.version === 7)) {
      return this.asaas ? this.asaas.reconcile(input as AsaasMarketplaceResidualRequest | AsaasMarketplaceHostRetentionOutboundRequest, providerTransferId) : { state: "unknown" };
    }
    if (input.version === 6) return this.successive.reconcile(input as StripeMarketplaceSuccessiveResidualRequest, providerTransferId);
    if (input.version === 4) return this.sources.reconcile(input, providerTransferId);
    try {
      this.validate(input);
      // Financial changes cannot erase a receipt that was already submitted.
      const charge = await this.payment(input);
      let observation: MarketplaceResidualObservation;
      if (providerTransferId) {
        if (!/^tr_[A-Za-z0-9_]+$/.test(providerTransferId)) return { state: "unknown" };
        const row = await this.stripe!.transfers.retrieve(providerTransferId);
        observation = row.id === providerTransferId ? this.observation(input, row) : { state: "unknown" };
      } else {
        const list = await this.stripe!.transfers.list({ transfer_group: input.reference, limit: 2 });
        observation = Array.isArray(list.data) && list.data.length === 1 && list.has_more === false ? this.observation(input, list.data[0]!) : { state: "unknown" };
      }
      if (input.version !== undefined && observation.state === "confirmed") {
        try {
          if (charge.disputed !== false) throw new Error("marketplace_residual_disputed");
          await this.refundHistory(input, charge.amount_refunded);
          await this.transferHistory(input, charge.created, observation.providerTransferId);
        } catch { return { ...observation, reconciliationRequired: true }; }
      }
      return observation;
    } catch { return { state: "unknown" }; }
  }

  private async payment(input: MarketplaceResidualRequest) {
    const capture = input.capture, payment = await this.stripe!.paymentIntents.retrieve(input.providerPaymentId);
    if (payment.id !== input.providerPaymentId || payment.status !== "succeeded" || payment.amount !== capture.amountCents ||
        payment.amount_received !== capture.amountCents || payment.currency !== "brl" || payment.livemode !== (capture.environment === "live") ||
        id(payment.latest_charge) !== capture.sourceId || payment.transfer_data || payment.application_fee_amount || payment.on_behalf_of) {
      throw new Error("marketplace_residual_payment_changed");
    }
    const charge = await this.stripe!.charges.retrieve(capture.sourceId);
    if (charge.id !== capture.sourceId || id(charge.payment_intent) !== input.providerPaymentId || charge.paid !== true || charge.captured !== true ||
        charge.amount !== capture.amountCents || charge.amount_captured !== capture.amountCents || charge.currency !== "brl" ||
        charge.livemode !== payment.livemode || charge.transfer_data || charge.transfer || charge.application_fee || charge.application_fee_amount ||
        charge.on_behalf_of || !Number.isSafeInteger(charge.amount_refunded) || charge.amount_refunded < 0 || charge.amount_refunded > capture.amountCents ||
        !Number.isSafeInteger(charge.created) || charge.created <= 0) throw new Error("marketplace_residual_charge_changed");
    return charge;
  }

  private async refundHistory(input: MarketplaceResidualRequest, refunded: number) {
    const expected = new Map(input.refunds.map(row => [row.providerOperationId, row.amountCents]));
    await this.scan(cursor => this.stripe!.refunds.list({ charge: input.capture.sourceId, limit: 100, ...(cursor ? { starting_after: cursor } : {}) }), row => {
      if (row.object !== "refund" || id(row.charge) !== input.capture.sourceId || id(row.payment_intent) !== input.providerPaymentId || row.currency !== "brl") {
        throw new Error("marketplace_residual_refund_history_changed");
      }
      if (["failed", "canceled"].includes(row.status ?? "") && !expected.has(row.id)) return;
      if (row.status !== "succeeded" || row.amount !== expected.get(row.id)) throw new Error("marketplace_residual_refund_history_changed");
      expected.delete(row.id);
    });
    if (expected.size || input.refunds.reduce((sum, row) => sum + row.amountCents, 0) !== refunded) throw new Error("marketplace_residual_refund_history_changed");
  }

  private async transferHistory(input: MarketplaceResidualRequest, since: number, currentReceipt?: string) {
    const seenReferences = new Set<string>();
    let currentObserved = false;
    const originals = new Map((input.originalTransfers ?? []).map(row => [row.providerTransferId, row]));
    await this.scan(cursor => this.stripe!.transfers.list({ created: { gte: since }, limit: 100, ...(cursor ? { starting_after: cursor } : {}) }), async row => {
      if (id(row.source_transaction) !== input.capture.sourceId) return;
      const original = originals.get(row.id);
      if (original) {
        const reversed = original.reversals.reduce((sum, reversal) => sum + reversal.amountCents, 0);
        if (row.object !== "transfer" || row.amount !== original.amountCents || id(row.destination) !== original.destination ||
            row.currency !== "brl" || row.livemode !== (input.capture.environment === "live") || row.transfer_group !== original.reference ||
            row.metadata?.marketplace_reference !== original.reference || row.metadata?.payment_intent_id !== input.providerPaymentId ||
            original.kind === "residual" && (row.metadata?.marketplace_operation !== "residual_payout" || row.metadata?.marketplace_request_hash !== original.requestHash) ||
            row.amount_reversed !== reversed || row.reversed !== (reversed === original.amountCents) || !id(row.balance_transaction)?.startsWith("txn_")) {
          throw new Error("marketplace_residual_original_transfer_changed");
        }
        await this.reversalHistory(input, original);
        originals.delete(row.id);
        return;
      }
      if (row.transfer_group === input.reference || row.metadata?.marketplace_reference === input.reference) {
        if (!currentReceipt) throw new ExistingResidualTransfer();
        if (row.id !== currentReceipt || this.observation(input, row).state !== "confirmed") throw new Error("marketplace_residual_current_transfer_changed");
        currentObserved = true;
      }
      const expected = input.transfers.find(t => t.reference === row.transfer_group);
      const { requestHash: _requestHash, ...raw } = input;
      const expectedHash = expected ? fundingHash({ ...raw, reference: expected.reference, destination: expected.destination, amountCents: expected.amountCents }) : undefined;
      if (!expected || seenReferences.has(expected.reference) || row.object !== "transfer" || row.amount !== expected.amountCents ||
          id(row.destination) !== expected.destination || row.currency !== "brl" || row.livemode !== (input.capture.environment === "live") ||
          row.metadata?.marketplace_reference !== expected.reference || row.metadata?.payment_intent_id !== input.providerPaymentId ||
          row.metadata?.marketplace_operation !== "residual_payout" || row.metadata?.marketplace_request_hash !== expectedHash ||
          !id(row.balance_transaction)?.startsWith("txn_") || row.reversed !== false || row.amount_reversed !== 0) {
        throw new Error("marketplace_residual_transfer_history_changed");
      }
      seenReferences.add(expected.reference);
    });
    if (originals.size || currentReceipt && !currentObserved) throw new Error("marketplace_residual_original_transfer_missing");
  }

  private async reversalHistory(input: MarketplaceResidualRequest, transfer: NonNullable<MarketplaceResidualRequest["originalTransfers"]>[number]) {
    const expected = new Map(transfer.reversals.map(row => [row.providerOperationId, row]));
    await this.scan(cursor => this.stripe!.transfers.listReversals(transfer.providerTransferId, { limit: 100, ...(cursor ? { starting_after: cursor } : {}) }), row => {
      const reversal = expected.get(row.id);
      if (!reversal || row.object !== "transfer_reversal" || id(row.transfer) !== transfer.providerTransferId || row.amount !== reversal.amountCents ||
          row.currency !== "brl" || row.source_refund || !id(row.balance_transaction)?.startsWith("txn_") ||
          row.metadata?.marketplace_reference !== reversal.reference || row.metadata?.marketplace_request_hash !== reversal.requestHash ||
          row.metadata?.payment_intent_id !== input.providerPaymentId || row.metadata?.marketplace_operation !== "transfer_reversal") {
        throw new Error("marketplace_residual_reversal_history_changed");
      }
      expected.delete(row.id);
    });
    if (expected.size) throw new Error("marketplace_residual_reversal_history_missing");
  }

  private async scan<T extends { id: string }>(fetchPage: (cursor?: string) => Promise<{ data: T[]; has_more: boolean }>, inspect: (row: T) => void | Promise<void>) {
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const result = await fetchPage(cursor);
      if (!Array.isArray(result.data) || result.data.length > 100 || typeof result.has_more !== "boolean") break;
      for (const row of result.data) {
        if (!row?.id || seen.has(row.id)) throw new Error("marketplace_residual_history_incomplete");
        seen.add(row.id); await inspect(row);
      }
      if (!result.has_more) return;
      if (!result.data.length) break;
      cursor = result.data.at(-1)!.id;
    }
    throw new Error("marketplace_residual_history_incomplete");
  }

  private metadata(input: MarketplaceResidualRequest) {
    return { marketplace_reference: input.reference, marketplace_request_hash: input.requestHash,
      payment_intent_id: input.providerPaymentId, marketplace_operation: "residual_payout" };
  }
  private observation(input: MarketplaceResidualRequest, row: Stripe.Transfer): MarketplaceResidualObservation {
    if (!/^tr_[A-Za-z0-9_]+$/.test(row.id) || row.object !== "transfer" || row.amount !== input.amountCents ||
        id(row.destination) !== input.destination || id(row.source_transaction) !== input.capture.sourceId || row.currency !== "brl" ||
        row.livemode !== (input.capture.environment === "live") || row.transfer_group !== input.reference ||
        !id(row.balance_transaction)?.startsWith("txn_") ||
        Object.entries(this.metadata(input)).some(([key, value]) => row.metadata?.[key] !== value) ||
        !Number.isSafeInteger(row.amount_reversed) || row.amount_reversed < 0 || row.amount_reversed > row.amount ||
        typeof row.reversed !== "boolean" || row.reversed !== (row.amount_reversed === row.amount)) return { state: "unknown" };
    const state = row.amount_reversed === row.amount ? "failed" : row.amount_reversed > 0 ? "unknown" : "confirmed";
    return { state, providerTransferId: row.id, amountCents: row.amount, observedAt: new Date().toISOString() };
  }
}
