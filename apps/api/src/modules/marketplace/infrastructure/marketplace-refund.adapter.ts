import Stripe from "stripe";
import type { MarketplaceRefundObservation, MarketplaceRefundProvider, MarketplaceRefundRequest, MarketplaceRefundSubmission } from "../domain/ports/marketplace-refund-provider.port.js";
import { marketplaceCaptureAccount } from "./marketplace-capture-account.js";
import { AsaasMarketplaceRefundAdapter } from "./asaas-marketplace-refund.adapter.js";
import { MarketplaceRefundContributionAdapter } from "./marketplace-refund-contribution.adapter.js";
import { buildMarketplaceRefundContributionCertificate, marketplaceContributionHash } from "../domain/services/marketplace-refund-contribution.js";
import type { AsaasMarketplaceWalletReturnRequest } from "../domain/ports/asaas-marketplace-transfer-recovery.port.js";
import { StripeMarketplaceSourceRefundAdapter } from "./stripe-marketplace-source-refund.adapter.js";

const id = (value: unknown): string | undefined => typeof value === "string" ? value :
  value && typeof value === "object" && "id" in value && typeof value.id === "string" ? value.id : undefined;
const cents = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 2_147_483_647;
const validReference = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_:-]{1,200}$/.test(value);
class ExistingMarketplaceRefund extends Error {}

/** Original platform captures only. Persistence owns submission admission. */
export class MarketplaceRefundAdapter implements MarketplaceRefundProvider {
  private readonly stripe?: Stripe;
  private readonly asaas: AsaasMarketplaceRefundAdapter;
  private readonly contributions: MarketplaceRefundContributionAdapter;
  private readonly sourceRefunds: StripeMarketplaceSourceRefundAdapter;

  constructor(private readonly config: { stripeSecret?: string; asaasKey?: string; asaasOrigin?: string }, request: typeof fetch = globalThis.fetch,
    verifyWalletReturns?: (requests: AsaasMarketplaceWalletReturnRequest[]) => Promise<boolean>,
    verifyResidualWalletReturns?: (requests: AsaasMarketplaceWalletReturnRequest[]) => Promise<boolean>) {
    this.asaas = new AsaasMarketplaceRefundAdapter(config, request, verifyWalletReturns, verifyResidualWalletReturns);
    this.contributions = new MarketplaceRefundContributionAdapter(config, request);
    this.sourceRefunds = new StripeMarketplaceSourceRefundAdapter(config, request);
    if (config.stripeSecret) this.stripe = new Stripe(config.stripeSecret, { apiVersion: "2026-04-22.dahlia",
      httpClient: Stripe.createFetchHttpClient(request), timeout: 15_000, maxNetworkRetries: 0 });
  }

  private residualWalletReturnMismatch(input: MarketplaceRefundRequest): boolean {
    return input.asaasResidualWalletReturns !== undefined && (input.provider !== "asaas" || input.kind !== "refund" ||
      input.asaasWalletReturns !== undefined || input.stripeSourceFunding !== undefined || input.fundingContributions !== undefined);
  }

  private validate(input: MarketplaceRefundRequest): void {
    if (input.provider !== "stripe") throw new Error("marketplace_refund_provider_not_supported");
    if (!["refund", "transfer_reversal"].includes(input.kind) || input.currency !== "BRL" ||
        !cents(input.amountCents) || !cents(input.paymentAmountCents) || input.amountCents > input.paymentAmountCents ||
        !/^pi_[A-Za-z0-9_]+$/.test(input.providerPaymentId) || !/^ch_[A-Za-z0-9_]+$/.test(input.sourceId) ||
        !validReference(input.reference) || !/^[a-f0-9]{64}$/.test(input.requestHash)) {
      throw new Error("marketplace_refund_request_invalid");
    }
    if (!Array.isArray(input.previousRefunds) || input.previousRefunds.length > 2000 ||
        new Set(input.previousRefunds.map(row => row?.providerOperationId)).size !== input.previousRefunds.length ||
        input.previousRefunds.some(row => !row || !/^re_[A-Za-z0-9_]+$/.test(row.providerOperationId) || !cents(row.amountCents)) ||
        input.previousRefunds.reduce((sum, row) => sum + row.amountCents, 0) > input.paymentAmountCents) {
      throw new Error("marketplace_refund_history_invalid");
    }
    if (input.kind === "refund" && input.transfer !== undefined) throw new Error("marketplace_refund_request_invalid");
    if (input.kind === "transfer_reversal" && (!input.transfer ||
        !/^tr_[A-Za-z0-9_]+$/.test(input.transfer.providerTransferId) || !/^acct_[A-Za-z0-9_]+$/.test(input.transfer.destination) ||
        !cents(input.transfer.amountCents) || input.transfer.amountCents > input.paymentAmountCents ||
        input.amountCents > input.transfer.amountCents || !validReference(input.transfer.reference))) {
      throw new Error("marketplace_refund_transfer_invalid");
    }
    if (input.transfer && (input.transfer.kind === undefined ? input.transfer.requestHash !== undefined :
        input.transfer.kind !== "residual" || !/^[a-f0-9]{64}$/.test(input.transfer.requestHash ?? "") || !/^mresidual_[a-f0-9]{64}$/.test(input.transfer.reference))) {
      throw new Error("marketplace_refund_transfer_invalid");
    }
    const previousReversals = input.transfer?.previousReversals ?? [];
    if (!Array.isArray(previousReversals) || previousReversals.length > 2000 ||
        new Set(previousReversals.map(row => row?.providerOperationId)).size !== previousReversals.length ||
        previousReversals.some(row => !row || !/^trr_[A-Za-z0-9_]+$/.test(row.providerOperationId) || !cents(row.amountCents) ||
          !validReference(row.reference) || row.reference === input.reference || !/^[a-f0-9]{64}$/.test(row.requestHash)) ||
        previousReversals.reduce((sum, row) => sum + row.amountCents, 0) > (input.transfer?.amountCents ?? 0)) {
      throw new Error("marketplace_refund_reversal_history_invalid");
    }
    const account = marketplaceCaptureAccount("stripe", input.environment, this.config.stripeSecret);
    if (input.accountFingerprint !== account.accountFingerprint) throw new Error("marketplace_refund_account_mismatch");
    if (input.asaasWalletReturns !== undefined || input.asaasResidualWalletReturns !== undefined) throw new Error("marketplace_refund_wallet_return_provider_mismatch");
    if (input.fundingContributions) {
      const funding = input.fundingContributions;
      if (input.kind !== "refund" || !/^[a-f0-9]{64}$/.test(funding.planHash) || !cents(funding.contributedNetCents) ||
          !Array.isArray(funding.certificates) || !funding.certificates.length || funding.certificates.length > 2000) {
        throw new Error("marketplace_refund_contribution_invalid");
      }
      const seen = [new Set<string>(), new Set<string>(), new Set<string>()];
      let total = 0;
      for (const certificate of funding.certificates) {
        const r = certificate.request;
        const rebuilt = buildMarketplaceRefundContributionCertificate(r, certificate.proof);
        if (!rebuilt || marketplaceContributionHash(rebuilt) !== marketplaceContributionHash(certificate) ||
            r.accountFingerprint !== input.accountFingerprint || r.environment !== input.environment ||
            r.originalPaymentIntentId !== input.providerPaymentId || r.originalChargeId !== input.sourceId) {
          throw new Error("marketplace_refund_contribution_invalid");
        }
        const receipts = [r.providerPaymentIntentId, certificate.proof.charge.id, certificate.proof.balance.id];
        for (let i = 0; i < receipts.length; i++) {
          if (seen[i]!.has(receipts[i]!)) throw new Error("marketplace_refund_contribution_duplicate");
          seen[i]!.add(receipts[i]!);
        }
        total += certificate.creditCents;
      }
      if (total !== funding.contributedNetCents) throw new Error("marketplace_refund_contribution_invalid");
    }
  }

  /** Recheck the separately paid fees immediately before refund submission.
   * Reconciliation of a refund already sent observes its actual effect even if
   * a contribution later changes, leaving that separate exposure in the journal. */
  private async assertAvailableContributions(input: MarketplaceRefundRequest): Promise<void> {
    for (const frozen of input.fundingContributions?.certificates ?? []) {
      const proof = await this.contributions.readContribution(frozen.request);
      const fresh = proof && buildMarketplaceRefundContributionCertificate(frozen.request, proof);
      if (!fresh || fresh.creditCents !== frozen.creditCents || fresh.processingFeeCents !== frozen.processingFeeCents ||
          marketplaceContributionHash(fresh.proof.paymentIntent) !== marketplaceContributionHash(frozen.proof.paymentIntent) ||
          marketplaceContributionHash(fresh.proof.charge) !== marketplaceContributionHash(frozen.proof.charge) ||
          marketplaceContributionHash(fresh.proof.balance) !== marketplaceContributionHash(frozen.proof.balance)) {
        throw new Error("marketplace_refund_contribution_no_longer_available");
      }
    }
  }

  private metadata(input: MarketplaceRefundRequest): Record<string, string> {
    return { marketplace_reference: input.reference, marketplace_request_hash: input.requestHash,
      payment_intent_id: input.providerPaymentId, marketplace_operation: input.kind };
  }

  private async payment(input: MarketplaceRefundRequest): Promise<Stripe.Charge> {
    const payment = await this.stripe!.paymentIntents.retrieve(input.providerPaymentId);
    if (payment.id !== input.providerPaymentId || payment.status !== "succeeded" || payment.amount !== input.paymentAmountCents ||
        payment.amount_received !== input.paymentAmountCents || payment.currency !== "brl" ||
        payment.livemode !== (input.environment === "live") || id(payment.latest_charge) !== input.sourceId ||
        payment.transfer_data || payment.application_fee_amount || payment.on_behalf_of) throw new Error("marketplace_refund_payment_mismatch");
    const charge = await this.stripe!.charges.retrieve(input.sourceId);
    if (charge.id !== input.sourceId || id(charge.payment_intent) !== input.providerPaymentId ||
        charge.amount !== input.paymentAmountCents || charge.amount_captured !== input.paymentAmountCents ||
        charge.currency !== "brl" || charge.paid !== true || charge.captured !== true ||
        charge.livemode !== (input.environment === "live") || charge.transfer_data || charge.application_fee ||
        charge.application_fee_amount || charge.on_behalf_of || charge.transfer ||
        !Number.isSafeInteger(charge.amount_refunded) || charge.amount_refunded < 0 || charge.amount_refunded > charge.amount) {
      throw new Error("marketplace_refund_charge_mismatch");
    }
    return charge;
  }

  private async transfer(input: MarketplaceRefundRequest): Promise<Stripe.Transfer> {
    const expected = input.transfer!;
    const transfer = await this.stripe!.transfers.retrieve(expected.providerTransferId);
    if (transfer.id !== expected.providerTransferId || id(transfer.destination) !== expected.destination ||
        id(transfer.source_transaction) !== input.sourceId || transfer.amount !== expected.amountCents ||
        transfer.currency !== "brl" || transfer.livemode !== (input.environment === "live") ||
        transfer.transfer_group !== expected.reference || transfer.metadata?.marketplace_reference !== expected.reference ||
        transfer.metadata?.payment_intent_id !== input.providerPaymentId ||
        expected.kind === "residual" && (transfer.metadata?.marketplace_operation !== "residual_payout" ||
          transfer.metadata?.marketplace_request_hash !== expected.requestHash) ||
        !Number.isSafeInteger(transfer.amount_reversed) || transfer.amount_reversed < 0 || transfer.amount_reversed > transfer.amount) {
      throw new Error("marketplace_refund_transfer_mismatch");
    }
    return transfer;
  }

  async submit(input: MarketplaceRefundRequest): Promise<MarketplaceRefundSubmission> {
    input = structuredClone(input);
    if (this.residualWalletReturnMismatch(input)) return { state: "not_submitted" };
    if (input.stripeSourceFunding !== undefined) return this.sourceRefunds.submit(input);
    if (input.provider === "asaas") return this.asaas.submit(input);
    let attempted = false;
    try {
      this.validate(input);
      const charge = await this.payment(input);
      if (charge.disputed !== false) throw new Error("marketplace_refund_dispute_requires_reconciliation");
      if (input.kind === "refund") {
        await this.assertRefundHistory(input, charge.amount_refunded);
        if (charge.amount - charge.amount_refunded < input.amountCents) throw new Error("marketplace_refund_remaining_insufficient");
        await this.assertAvailableContributions(input);
        if (input.fundingContributions) {
          // Receipt verification may require many GETs. Recheck the original
          // charge after them so an intervening dispute/refund blocks this POST.
          const current = await this.payment(input);
          if (current.disputed !== false || current.amount_refunded !== charge.amount_refunded) {
            throw new Error("marketplace_refund_original_payment_changed");
          }
          await this.assertRefundHistory(input, current.amount_refunded);
        }
        attempted = true;
        const receipt = await this.stripe!.refunds.create({ charge: input.sourceId, amount: input.amountCents,
          reason: "requested_by_customer", metadata: this.metadata(input) }, { idempotencyKey: input.reference });
        return this.awaitIndependentRead(this.refundObservation(input, receipt));
      }
      await this.assertRefundHistory(input, charge.amount_refunded);
      const transfer = await this.transfer(input);
      await this.assertReversalHistory(input, transfer.amount_reversed);
      if (transfer.reversed || transfer.amount - transfer.amount_reversed < input.amountCents) {
        throw new Error("marketplace_refund_reversal_remaining_insufficient");
      }
      attempted = true;
      const receipt = await this.stripe!.transfers.createReversal(input.transfer!.providerTransferId,
        { amount: input.amountCents, metadata: this.metadata(input) }, { idempotencyKey: input.reference });
      return this.awaitIndependentRead(this.reversalObservation(input, receipt));
    } catch (error) {
      // Even an HTTP rejection after POST is not local evidence that no operation
      // exists. Never reopen its claim: reconcile the original operation instead.
      return { state: attempted || error instanceof ExistingMarketplaceRefund ? "unknown" : "not_submitted" };
    }
  }

  async reconcile(input: MarketplaceRefundRequest, providerOperationId?: string): Promise<MarketplaceRefundObservation> {
    input = structuredClone(input);
    if (this.residualWalletReturnMismatch(input)) return { state: "unknown" };
    if (input.stripeSourceFunding !== undefined) return this.sourceRefunds.reconcile(input, providerOperationId);
    if (input.provider === "asaas") return this.asaas.reconcile(input, providerOperationId);
    try {
      this.validate(input);
      await this.payment(input);
      if (input.kind === "refund") {
        if (providerOperationId) {
          if (!/^re_[A-Za-z0-9_]+$/.test(providerOperationId)) return { state: "unknown" };
          const receipt = await this.stripe!.refunds.retrieve(providerOperationId);
          if (receipt.id !== providerOperationId) return { state: "unknown" };
          return this.refundObservation(input, receipt);
        }
        const found = await this.findReceipt(input, cursor => this.stripe!.refunds.list({ charge: input.sourceId,
          limit: 100, ...(cursor ? { starting_after: cursor } : {}) }));
        return found ? this.refundObservation(input, found as Stripe.Refund) : { state: "unknown" };
      }
      await this.transfer(input);
      if (providerOperationId) {
        if (!/^trr_[A-Za-z0-9_]+$/.test(providerOperationId)) return { state: "unknown" };
        const receipt = await this.stripe!.transfers.retrieveReversal(input.transfer!.providerTransferId, providerOperationId);
        if (receipt.id !== providerOperationId) return { state: "unknown" };
        return this.reversalObservation(input, receipt);
      }
      const found = await this.findReceipt(input, cursor => this.stripe!.transfers.listReversals(input.transfer!.providerTransferId,
        { limit: 100, ...(cursor ? { starting_after: cursor } : {}) }));
      return found ? this.reversalObservation(input, found as Stripe.TransferReversal) : { state: "unknown" };
    } catch { return { state: "unknown" }; }
  }

  private async findReceipt(input: MarketplaceRefundRequest,
    fetchPage: (cursor?: string) => Promise<{ data: Array<{ id: string; metadata?: Stripe.Metadata | null }>; has_more: boolean }>): Promise<unknown | undefined> {
    const seen = new Set<string>();
    let candidate: unknown, cursor: string | undefined;
    // A bounded/incomplete scan cannot authorize another financial mutation.
    for (let page = 0; page < 20; page++) {
      const result = await fetchPage(cursor);
      if (!Array.isArray(result.data) || typeof result.has_more !== "boolean" || result.data.length > 100) return;
      for (const receipt of result.data) {
        if (!receipt || typeof receipt.id !== "string" || seen.has(receipt.id)) return;
        seen.add(receipt.id);
        if (receipt.metadata?.marketplace_reference === input.reference) {
          if (candidate) return;
          candidate = receipt;
        }
      }
      if (!result.has_more) return candidate;
      if (!result.data.length) return;
      cursor = result.data[result.data.length - 1]!.id;
    }
    return;
  }

  private async assertRefundHistory(input: MarketplaceRefundRequest, refundedCents: number): Promise<void> {
    const expected = new Map(input.previousRefunds.map(row => [row.providerOperationId, row.amountCents]));
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const result = await this.stripe!.refunds.list({ charge: input.sourceId, limit: 100,
        ...(cursor ? { starting_after: cursor } : {}) });
      if (!Array.isArray(result.data) || typeof result.has_more !== "boolean" || result.data.length > 100) break;
      for (const receipt of result.data) {
        if (!receipt || typeof receipt.id !== "string" || seen.has(receipt.id) || receipt.object !== "refund" ||
            id(receipt.charge) !== input.sourceId || id(receipt.payment_intent) !== input.providerPaymentId || receipt.currency !== "brl") {
          throw new Error("marketplace_refund_external_history_unreconciled");
        }
        seen.add(receipt.id);
        // A failed attempt with this very reference also must not be resubmitted.
        if (receipt.metadata?.marketplace_reference === input.reference) throw new ExistingMarketplaceRefund();
        if (["failed", "canceled"].includes(receipt.status ?? "") && !expected.has(receipt.id)) continue;
        if (receipt.status !== "succeeded" || expected.get(receipt.id) !== receipt.amount) {
          throw new Error("marketplace_refund_external_history_unreconciled");
        }
        expected.delete(receipt.id);
      }
      if (!result.has_more) {
        if (expected.size || input.previousRefunds.reduce((sum, row) => sum + row.amountCents, 0) !== refundedCents) {
          throw new Error("marketplace_refund_external_history_unreconciled");
        }
        return;
      }
      if (!result.data.length) break;
      cursor = result.data[result.data.length - 1]!.id;
    }
    throw new Error("marketplace_refund_history_incomplete");
  }

  private matchesMetadata(input: MarketplaceRefundRequest, metadata: Stripe.Metadata | null): boolean {
    return Object.entries(this.metadata(input)).every(([key, value]) => metadata?.[key] === value);
  }

  private async assertReversalHistory(input: MarketplaceRefundRequest, reversedCents: number): Promise<void> {
    const history = input.transfer!.previousReversals ?? [];
    const expected = new Map(history.map(row => [row.providerOperationId, row]));
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const result = await this.stripe!.transfers.listReversals(input.transfer!.providerTransferId, { limit: 100,
        ...(cursor ? { starting_after: cursor } : {}) });
      if (!Array.isArray(result.data) || typeof result.has_more !== "boolean" || result.data.length > 100) break;
      for (const receipt of result.data) {
        if (!receipt || typeof receipt.id !== "string" || seen.has(receipt.id)) throw new Error("marketplace_refund_reversal_history_unreconciled");
        seen.add(receipt.id);
        if (receipt.metadata?.marketplace_reference === input.reference) throw new ExistingMarketplaceRefund();
        const prior = expected.get(receipt.id);
        if (!prior || receipt.object !== "transfer_reversal" || receipt.amount !== prior.amountCents || receipt.currency !== "brl" ||
            id(receipt.transfer) !== input.transfer!.providerTransferId || receipt.source_refund || !id(receipt.balance_transaction)?.startsWith("txn_") ||
            receipt.metadata?.marketplace_reference !== prior.reference || receipt.metadata?.marketplace_request_hash !== prior.requestHash ||
            receipt.metadata?.payment_intent_id !== input.providerPaymentId || receipt.metadata?.marketplace_operation !== "transfer_reversal") {
          throw new Error("marketplace_refund_reversal_history_unreconciled");
        }
        expected.delete(receipt.id);
      }
      if (!result.has_more) {
        if (expected.size || history.reduce((sum, row) => sum + row.amountCents, 0) !== reversedCents) throw new Error("marketplace_refund_reversal_history_unreconciled");
        return;
      }
      if (!result.data.length) break;
      cursor = result.data[result.data.length - 1]!.id;
    }
    throw new Error("marketplace_refund_reversal_history_incomplete");
  }

  private awaitIndependentRead(receipt: MarketplaceRefundObservation): MarketplaceRefundObservation {
    // Persist the identity from POST, but settle accounting only after reading
    // the provider operation independently on the next reconciliation pass.
    return receipt.state === "unknown" ? receipt : { ...receipt, state: "pending" };
  }

  private refundObservation(input: MarketplaceRefundRequest, receipt: Stripe.Refund): MarketplaceRefundObservation {
    if (!/^re_[A-Za-z0-9_]+$/.test(receipt.id) || receipt.object !== "refund" || receipt.amount !== input.amountCents ||
        receipt.currency !== "brl" || id(receipt.charge) !== input.sourceId || id(receipt.payment_intent) !== input.providerPaymentId ||
        receipt.transfer_reversal || receipt.source_transfer_reversal || !this.matchesMetadata(input, receipt.metadata)) {
      return { state: "unknown" };
    }
    const state = receipt.status === "succeeded" ? "confirmed" : ["failed", "canceled"].includes(receipt.status ?? "") ? "failed" :
      ["pending", "requires_action"].includes(receipt.status ?? "") ? "pending" : "unknown";
    return { state, providerOperationId: receipt.id, amountCents: receipt.amount, observedAt: new Date().toISOString() };
  }

  private reversalObservation(input: MarketplaceRefundRequest, receipt: Stripe.TransferReversal): MarketplaceRefundObservation {
    if (!/^trr_[A-Za-z0-9_]+$/.test(receipt.id) || receipt.object !== "transfer_reversal" || receipt.amount !== input.amountCents ||
        receipt.currency !== "brl" || id(receipt.transfer) !== input.transfer!.providerTransferId || receipt.source_refund ||
        !id(receipt.balance_transaction)?.startsWith("txn_") || !this.matchesMetadata(input, receipt.metadata)) return { state: "unknown" };
    return { state: "confirmed", providerOperationId: receipt.id, amountCents: receipt.amount, observedAt: new Date().toISOString() };
  }
}
