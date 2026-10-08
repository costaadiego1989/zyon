import Stripe from "stripe";
import type { MarketplaceResidualObservation, MarketplaceResidualRequest } from "../domain/ports/marketplace-residual-provider.port.js";
import { buildMarketplaceRefundContributionCertificate, marketplaceContributionHash } from "../domain/services/marketplace-refund-contribution.js";
import { marketplaceCaptureAccount } from "./marketplace-capture-account.js";
import { MarketplaceRefundContributionAdapter } from "./marketplace-refund-contribution.adapter.js";
import { fundingHash } from "./repositories/prisma-marketplace-funding.repository.js";
const id = (value: unknown): string | undefined => typeof value === "string" ? value :
  value && typeof value === "object" && "id" in value && typeof value.id === "string" ? value.id : undefined;
const cents = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= 2_147_483_647;
class ExistingTransfer extends Error {}

/** The only POST transfers a frozen allowance from its own certified charge.
 * Recovery always reads an existing receipt and preserves it even if the source
 * subsequently changes; it never reopens a submission permit. */
export class StripeMarketplaceResidualSourcesAdapter {
  private readonly stripe?: Stripe;
  private readonly contributions: MarketplaceRefundContributionAdapter;
  constructor(private readonly config: { stripeSecret?: string }, request: typeof fetch = globalThis.fetch) {
    this.contributions = new MarketplaceRefundContributionAdapter(config, request);
    if (config.stripeSecret) this.stripe = new Stripe(config.stripeSecret, { apiVersion: "2026-04-22.dahlia",
      httpClient: Stripe.createFetchHttpClient(request), maxNetworkRetries: 0, timeout: 15_000 });
  }
  private validate(input: MarketplaceResidualRequest) {
    const { requestHash, ...raw } = input, a = input.sourceAllocation, f = input.fundingContributions;
    const fail = (): never => { throw Error("marketplace_residual_sources_request_invalid"); };
    if (!this.stripe || input.version !== 4 || input.provider !== "stripe" || input.currency !== "BRL" ||
        !a || a.version !== 4 || !f || !Array.isArray(f.certificates) || !f.certificates.length || f.certificates.length > 2000 ||
        !/^[a-f0-9]{64}$/.test(f.planHash) || input.originalTransfers !== undefined || input.previousGenerations !== undefined ||
        fundingHash(raw) !== requestHash || !/^[a-f0-9]{64}$/.test(requestHash) ||
        input.capture.provider !== "stripe" || input.capture.providerPaymentId !== input.providerPaymentId ||
        input.capture.accountFingerprint !== input.accountFingerprint || input.capture.currency !== "BRL" ||
        marketplaceCaptureAccount("stripe", input.capture.environment, this.config.stripeSecret).accountFingerprint !== input.accountFingerprint ||
        !/^pi_[A-Za-z0-9_]+$/.test(input.providerPaymentId) || !/^ch_[A-Za-z0-9_]+$/.test(input.capture.sourceId) ||
        !/^txn_[A-Za-z0-9_]+$/.test(input.capture.balanceTransactionId ?? "") ||
        !cents(input.capture.amountCents) || !cents(input.capture.providerFeeCents) || !cents(input.capture.netAmountCents) ||
        input.capture.amountCents - input.capture.providerFeeCents !== input.capture.netAmountCents ||
        !Array.isArray(input.refunds) || !input.refunds.length || input.refunds.length > 2000 ||
        new Set(input.refunds.map(r => r.providerOperationId)).size !== input.refunds.length ||
        input.refunds.some(r => !/^re_[A-Za-z0-9_]+$/.test(r.providerOperationId) || !cents(r.amountCents) || !r.amountCents) ||
        a.refundedCents !== input.refunds.reduce((s, row) => s + row.amountCents, 0) ||
        a.capturedNetCents !== input.capture.netAmountCents || a.contributedNetCents !== f.contributedNetCents ||
        !Array.isArray(a.sources) || a.sources.length !== f.certificates.length + 1 ||
        new Set(a.sources.map(s => s.sourceId)).size !== a.sources.length ||
        new Set(a.sources.map(s => s.chargeId)).size !== a.sources.length ||
        new Set(a.sources.map(s => s.providerPaymentId)).size !== a.sources.length ||
        new Set(a.sources.map(s => s.balanceTransactionId)).size !== a.sources.length ||
        !Array.isArray(a.beneficiaries) || new Set(a.beneficiaries.map(b => b.merchantId)).size !== a.beneficiaries.length ||
        a.beneficiaries.some((b, index) => !b.merchantId || !/^acct_[A-Za-z0-9_]+$/.test(b.destination) || !cents(b.amountCents) || !cents(b.providerFeeCents) ||
          index > 0 && a.beneficiaries[index - 1]!.merchantId.localeCompare(b.merchantId) >= 0) ||
        a.beneficiaries.reduce((s, b) => s + b.amountCents, 0) !== a.payoutTotalCents ||
        !Array.isArray(input.sourceTransfers) || input.sourceTransfers.length !== a.sources.length) fail();
    const capture = input.capture, remaining = new Map(a!.beneficiaries.map(b => [b.merchantId, b.amountCents]));
    let refund = a!.refundedCents;
    for (const [index, source] of a!.sources.entries()) {
      const certificate = index ? f!.certificates[index - 1]! : undefined;
      if (certificate) {
        const rebuilt = buildMarketplaceRefundContributionCertificate(certificate.request, certificate.proof);
        if (!rebuilt || marketplaceContributionHash(rebuilt) !== marketplaceContributionHash(certificate) ||
            certificate.request.originalPaymentIntentId !== input.providerPaymentId || certificate.request.originalChargeId !== capture.sourceId ||
            certificate.request.originalBalanceTransactionId !== capture.balanceTransactionId ||
            certificate.request.accountFingerprint !== input.accountFingerprint || certificate.request.environment !== capture.environment ||
            source.sourceId !== `contribution:${certificate.certificateHash}` || source.providerPaymentId !== certificate.request.providerPaymentIntentId ||
            source.chargeId !== certificate.proof.charge.id || source.balanceTransactionId !== certificate.proof.balance.id ||
            source.capturedGrossCents !== certificate.request.grossAmountCents || source.processingFeeCents !== certificate.processingFeeCents ||
            source.creditedNetCents !== certificate.creditCents || source.excessLiabilityCents !== (certificate.excessLiabilityCents ?? 0) || source.platformRetainedCents !== 0) fail();
      } else if (source.sourceId !== "original" || source.providerPaymentId !== input.providerPaymentId || source.chargeId !== capture.sourceId ||
          source.balanceTransactionId !== capture.balanceTransactionId || source.capturedGrossCents !== capture.amountCents ||
          source.processingFeeCents !== capture.providerFeeCents || source.creditedNetCents !== capture.netAmountCents ||
          source.excessLiabilityCents !== 0 || source.platformRetainedCents !== a!.platformRetainedCents) fail();
      if (![source.capturedGrossCents, source.processingFeeCents, source.creditedNetCents, source.refundDebitCents,
        source.platformRetainedCents, source.excessLiabilityCents, source.payoutTotalCents].every(cents) ||
          source.refundDebitCents !== Math.min(refund, source.creditedNetCents) ||
          source.capturedGrossCents - source.processingFeeCents !== source.creditedNetCents + source.excessLiabilityCents ||
          source.creditedNetCents !== source.refundDebitCents + source.platformRetainedCents + source.payoutTotalCents ||
          !Array.isArray(source.beneficiaries)) fail();
      refund -= source.refundDebitCents;
      let available = source.payoutTotalCents;
      const expected: Array<{ merchantId: string; destination: string; amountCents: number }> = [];
      for (const b of a!.beneficiaries) {
        const amountCents = Math.min(available, remaining.get(b.merchantId)!);
        if (amountCents) expected.push({ merchantId: b.merchantId, destination: b.destination, amountCents });
        remaining.set(b.merchantId, remaining.get(b.merchantId)! - amountCents); available -= amountCents;
      }
      const transfers = input.sourceTransfers![index];
      if (available || fundingHash(expected) !== fundingHash(source.beneficiaries) || transfers?.sourceId !== source.sourceId ||
          transfers.transfers.length !== expected.length || transfers.transfers.some((t, n) =>
            !/^mresidual_[a-f0-9]{64}$/.test(t.reference) || t.destination !== expected[n]?.destination || t.amountCents !== expected[n]?.amountCents)) fail();
    }
    const selected = a!.sources.find(s => s.sourceId === input.sourceId);
    const selectedTransfers = input.sourceTransfers!.find(s => s.sourceId === input.sourceId)?.transfers;
    const allReferences = input.sourceTransfers!.flatMap(s => s.transfers.map(t => t.reference));
    if (refund || [...remaining.values()].some(n => n !== 0) || new Set(allReferences).size !== allReferences.length ||
        a!.sources.slice(1).reduce((s, row) => s + row.creditedNetCents, 0) !== a!.contributedNetCents ||
        a!.sources.slice(1).reduce((s, row) => s + row.processingFeeCents, 0) !== a!.contributionProcessingFeeCents ||
        a!.sources.reduce((s, row) => s + row.excessLiabilityCents, 0) !== a!.excessLiabilityCents ||
        !selected || input.remainingTotalCents !== selected.payoutTotalCents || fundingHash(selectedTransfers) !== fundingHash(input.transfers) ||
        !input.transfers.some(t => t.reference === input.reference && t.destination === input.destination && t.amountCents === input.amountCents) ||
        !cents(input.amountCents) || !input.amountCents || a!.capturedNetCents + a!.contributedNetCents !==
          a!.refundedCents + a!.platformRetainedCents + a!.payoutTotalCents) fail();
    return selected!;
  }
  private metadata(input: MarketplaceResidualRequest) {
    return { marketplace_reference: input.reference, marketplace_request_hash: input.requestHash,
      payment_intent_id: input.providerPaymentId, marketplace_operation: "residual_payout", marketplace_source_id: input.sourceId! };
  }
  private observation(input: MarketplaceResidualRequest, row: Stripe.Transfer): MarketplaceResidualObservation {
    const source = input.sourceAllocation!.sources.find(s => s.sourceId === input.sourceId)!;
    if (!/^tr_[A-Za-z0-9_]+$/.test(row.id) || row.object !== "transfer" || row.amount !== input.amountCents ||
        id(row.source_transaction) !== source.chargeId || id(row.destination) !== input.destination || row.currency !== "brl" ||
        row.livemode !== (input.capture.environment === "live") || row.transfer_group !== input.reference ||
        !id(row.balance_transaction)?.startsWith("txn_") || Object.entries(this.metadata(input)).some(([k, v]) => row.metadata?.[k] !== v) ||
        !cents(row.amount_reversed) || row.amount_reversed > row.amount || row.reversed !== (row.amount_reversed === row.amount)) return { state: "unknown" };
    return { state: row.amount_reversed === row.amount ? "failed" : row.amount_reversed ? "unknown" : "confirmed",
      providerTransferId: row.id, amountCents: row.amount, observedAt: new Date().toISOString() };
  }
  async submit(input: MarketplaceResidualRequest) {
    let attempted = false;
    try {
      const source = this.validate(input);
      const since = await this.funding(input);
      await this.transfers(input, since);
      await this.funding(input);
      attempted = true;
      const row = await this.stripe!.transfers.create({ amount: input.amountCents, currency: "brl", destination: input.destination,
        source_transaction: source.chargeId, transfer_group: input.reference, metadata: this.metadata(input) }, { idempotencyKey: input.reference });
      const observed = this.observation(input, row);
      return observed.state === "unknown" ? observed : { ...observed, state: "pending" as const };
    } catch (error) { return { state: attempted || error instanceof ExistingTransfer ? "unknown" as const : "not_submitted" as const }; }
  }
  async reconcile(input: MarketplaceResidualRequest, providerTransferId?: string): Promise<MarketplaceResidualObservation> {
    try {
      this.validate(input);
      let observation: MarketplaceResidualObservation;
      if (providerTransferId) {
        if (!/^tr_[A-Za-z0-9_]+$/.test(providerTransferId)) return { state: "unknown" };
        const row = await this.stripe!.transfers.retrieve(providerTransferId);
        observation = row.id === providerTransferId ? this.observation(input, row) : { state: "unknown" };
      } else {
        const page = await this.stripe!.transfers.list({ transfer_group: input.reference, limit: 2 });
        observation = page.has_more === false && page.data?.length === 1 ? this.observation(input, page.data[0]!) : { state: "unknown" };
      }
      if (observation.state === "confirmed") {
        try { await this.transfers(input, await this.funding(input), observation.providerTransferId); }
        catch { return { ...observation, reconciliationRequired: true }; }
      }
      return observation;
    } catch { return { state: "unknown" }; }
  }
  private async funding(input: MarketplaceResidualRequest) {
    let since = await this.original(input);
    for (const c of input.fundingContributions!.certificates) {
      const proof = await this.contributions.readContribution(c.request);
      if (!proof) throw Error("marketplace_residual_contribution_changed");
      const { observedAt: _beforeAt, ...before } = c.proof, { observedAt: _afterAt, ...after } = proof;
      if (fundingHash(before) !== fundingHash(after)) throw Error("marketplace_residual_contribution_changed");
      const charge = await this.stripe!.charges.retrieve(c.proof.charge.id);
      if (!Number.isSafeInteger(charge.created) || charge.created <= 0) throw Error("marketplace_residual_contribution_changed");
      since = Math.min(since, charge.created);
    }
    await this.original(input); // Original refund/dispute is reread after every source proof.
    return since;
  }
  private async original(input: MarketplaceResidualRequest) {
    const c = input.capture, pi = await this.stripe!.paymentIntents.retrieve(input.providerPaymentId);
    if (pi.id !== input.providerPaymentId || pi.status !== "succeeded" || pi.amount !== c.amountCents || pi.amount_received !== c.amountCents ||
        pi.currency !== "brl" || pi.livemode !== (c.environment === "live") || id(pi.latest_charge) !== c.sourceId ||
        pi.transfer_data || pi.application_fee_amount || pi.on_behalf_of) throw Error("marketplace_residual_original_changed");
    const charge = await this.stripe!.charges.retrieve(c.sourceId), bt = await this.stripe!.balanceTransactions.retrieve(c.balanceTransactionId!);
    if (charge.id !== c.sourceId || id(charge.payment_intent) !== pi.id || !charge.paid || !charge.captured || charge.disputed !== false ||
        charge.amount !== c.amountCents || charge.amount_captured !== c.amountCents || charge.currency !== "brl" || charge.livemode !== pi.livemode ||
        charge.transfer_data || charge.transfer || charge.application_fee || charge.application_fee_amount || charge.on_behalf_of ||
        id(charge.balance_transaction) !== c.balanceTransactionId || bt.id !== c.balanceTransactionId || id(bt.source) !== c.sourceId ||
        bt.currency !== "brl" || bt.type !== "charge" || bt.status !== "available" || bt.exchange_rate ||
        bt.amount !== c.amountCents || bt.fee !== c.providerFeeCents || bt.net !== c.netAmountCents ||
        !Number.isSafeInteger(charge.created) || charge.created <= 0) throw Error("marketplace_residual_original_changed");
    const expected = new Map(input.refunds.map(row => [row.providerOperationId, row.amountCents]));
    await this.scan(cursor => this.stripe!.refunds.list({ charge: c.sourceId, limit: 100, ...(cursor ? { starting_after: cursor } : {}) }), row => {
      if (row.object !== "refund" || id(row.charge) !== c.sourceId || id(row.payment_intent) !== input.providerPaymentId || row.currency !== "brl") throw Error("refund");
      if (["failed", "canceled"].includes(row.status ?? "") && !expected.has(row.id)) return;
      if (row.status !== "succeeded" || row.amount !== expected.get(row.id)) throw Error("refund");
      expected.delete(row.id);
    });
    if (expected.size || charge.amount_refunded !== input.sourceAllocation!.refundedCents) throw Error("refund");
    return charge.created;
  }
  private async transfers(input: MarketplaceResidualRequest, since: number, receipt?: string) {
    const sources = new Map(input.sourceAllocation!.sources.map(s => [s.chargeId, s]));
    const seen = new Set<string>(); let currentObserved = false;
    await this.scan(cursor => this.stripe!.transfers.list({ created: { gte: since }, limit: 100, ...(cursor ? { starting_after: cursor } : {}) }), row => {
      const source = sources.get(id(row.source_transaction) ?? "");
      if (!source) return;
      if (row.transfer_group === input.reference || row.metadata?.marketplace_reference === input.reference) {
        if (!receipt) throw new ExistingTransfer();
        if (row.id !== receipt) throw Error("duplicate");
        currentObserved = true;
      }
      const transfers = input.sourceTransfers!.find(s => s.sourceId === source.sourceId)!.transfers;
      const transfer = transfers.find(t => t.reference === row.transfer_group);
      if (!transfer || seen.has(transfer.reference)) throw Error("unexpected_source_transfer");
      const { requestHash: _hash, ...raw } = input;
      const sibling = { ...raw, sourceId: source.sourceId, remainingTotalCents: source.payoutTotalCents, transfers,
        reference: transfer.reference, destination: transfer.destination, amountCents: transfer.amountCents };
      const expected = { ...sibling, requestHash: fundingHash(sibling) };
      if (this.observation(expected, row).state !== "confirmed") throw Error("source_transfer_changed");
      seen.add(transfer.reference);
    });
    if (receipt && !currentObserved) throw Error("source_transfer_missing");
  }
  private async scan<T extends { id: string }>(read: (cursor?: string) => Promise<{ data: T[]; has_more: boolean }>, inspect: (row: T) => void) {
    const seen = new Set<string>(); let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const result = await read(cursor);
      if (!Array.isArray(result.data) || result.data.length > 100 || typeof result.has_more !== "boolean") break;
      for (const row of result.data) { if (!row?.id || seen.has(row.id)) throw Error("history_incomplete"); seen.add(row.id); inspect(row); }
      if (!result.has_more) return;
      if (!result.data.length) break; cursor = result.data.at(-1)!.id;
    }
    throw Error("history_incomplete");
  }
}
