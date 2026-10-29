import Stripe from "stripe";
import type { MarketplaceResidualObservation } from "../domain/ports/marketplace-residual-provider.port.js";
import type { StripeMarketplaceSuccessiveResidualGenerationObservation, StripeMarketplaceSuccessiveResidualGenerationRequest,
  StripeMarketplaceSuccessiveResidualRequest } from "../domain/ports/stripe-marketplace-successive-residual.port.js";
import { buildStripeMarketplaceSuccessiveResidualGenerationRequest, buildStripeMarketplaceSuccessiveResidualRequest,
  stripeSuccessiveResidualMetadata, validStripeSuccessiveResidualGenerationProof } from "../domain/services/stripe-marketplace-successive-residual.js";
import { marketplaceContributionHash as hash } from "../domain/services/marketplace-refund-contribution.js";
import { marketplaceCaptureAccount } from "./marketplace-capture-account.js";
import { StripeMarketplaceSourceRefundAdapter } from "./stripe-marketplace-source-refund.adapter.js";

const id = (value: unknown): string | undefined => typeof value === "string" ? value :
  value && typeof value === "object" && "id" in value && typeof value.id === "string" ? value.id : undefined;

export class StripeMarketplaceSuccessiveResidualAdapter {
  private readonly stripe?: Stripe;
  private readonly sources: StripeMarketplaceSourceRefundAdapter;
  constructor(private readonly config: { stripeSecret?: string }, request: typeof fetch = globalThis.fetch) {
    this.sources = new StripeMarketplaceSourceRefundAdapter(config, request);
    if (config.stripeSecret) this.stripe = new Stripe(config.stripeSecret, { apiVersion: "2026-04-22.dahlia",
      httpClient: Stripe.createFetchHttpClient(request), timeout: 15_000, maxNetworkRetries: 0 });
  }
  private account(environment: "test" | "live", fingerprint: string) {
    if (!this.stripe || marketplaceCaptureAccount("stripe", environment, this.config.stripeSecret).accountFingerprint !== fingerprint) throw Error("stripe_successive_account_changed");
  }
  private validate(input: StripeMarketplaceSuccessiveResidualRequest) {
    this.account(input.capture.environment, input.accountFingerprint);
    if (hash(input) !== hash(buildStripeMarketplaceSuccessiveResidualRequest(input.stripeSuccessiveFunding.basis, input.sourceId, input.beneficiaryMerchantId))) {
      throw Error("stripe_successive_request_changed");
    }
    return input;
  }
  private observation(input: StripeMarketplaceSuccessiveResidualRequest, row: Stripe.Transfer): MarketplaceResidualObservation {
    const source = input.stripeSuccessiveFunding.allocation.sources.find(s => s.sourceId === input.sourceId)!;
    if (!/^tr_[A-Za-z0-9_]+$/.test(row.id) || row.object !== "transfer" || row.amount !== input.amountCents || row.currency !== "brl" ||
        row.livemode !== (input.capture.environment === "live") || id(row.source_transaction) !== source.chargeId || id(row.destination) !== input.destination ||
        row.transfer_group !== input.reference || row.amount_reversed !== 0 || row.reversed !== false || !id(row.balance_transaction)?.startsWith("txn_") ||
        !Object.entries(stripeSuccessiveResidualMetadata(input)).every(([k, v]) => row.metadata?.[k] === v)) return { state: "unknown" };
    return { state: "confirmed", providerTransferId: row.id, amountCents: row.amount, observedAt: new Date().toISOString() };
  }
  async submit(untrusted: StripeMarketplaceSuccessiveResidualRequest): Promise<MarketplaceResidualObservation | { state: "not_submitted" }> {
    let attempted = false, existing = false;
    try {
      const input = this.validate(structuredClone(untrusted)), proof = await this.sources.certifyCompletedRefundForResidual(input.stripeSuccessiveFunding.basis);
      if (proof.state !== "confirmed") throw Error("stripe_successive_sources_unproven");
      if (proof.transferReceipts.some(r => r.requestHash === input.requestHash)) { existing = true; throw Error("stripe_successive_existing_transfer"); }
      const source = input.stripeSuccessiveFunding.allocation.sources.find(s => s.sourceId === input.sourceId)!;
      attempted = true;
      const row = await this.stripe!.transfers.create({ amount: input.amountCents, currency: "brl", destination: input.destination,
        source_transaction: source.chargeId, transfer_group: input.reference, metadata: stripeSuccessiveResidualMetadata(input) }, { idempotencyKey: input.reference });
      const observed = this.observation(input, row);
      return observed.state === "unknown" ? observed : { ...observed, state: "pending" };
    } catch { return { state: attempted || existing ? "unknown" : "not_submitted" }; }
  }
  async reconcile(untrusted: StripeMarketplaceSuccessiveResidualRequest, providerTransferId?: string): Promise<MarketplaceResidualObservation> {
    try {
      const input = this.validate(structuredClone(untrusted));
      let row: Stripe.Transfer | undefined;
      if (providerTransferId) {
        if (!/^tr_[A-Za-z0-9_]+$/.test(providerTransferId)) return { state: "unknown" };
        row = await this.stripe!.transfers.retrieve(providerTransferId);
        if (row.id !== providerTransferId) return { state: "unknown" };
      } else {
        const result = await this.stripe!.transfers.list({ transfer_group: input.reference, limit: 2 });
        if (result.has_more !== false || result.data.length !== 1) return { state: "unknown" };
        row = result.data[0];
      }
      if (!row) return { state: "unknown" };
      const observed = this.observation(input, row);
      if (observed.state !== "confirmed") return observed;
      const funding = await this.sources.certifyCompletedRefundForResidual(input.stripeSuccessiveFunding.basis);
      if (funding.state !== "confirmed" || !funding.transferReceipts.some(r => r.providerTransferId === observed.providerTransferId && r.requestHash === input.requestHash)) {
        return { ...observed, reconciliationRequired: true };
      }
      return observed;
    } catch { return { state: "unknown" }; }
  }
  /** Always GET. Even a zero-operation successor requires this complete proof. */
  async certifyGeneration(untrusted: StripeMarketplaceSuccessiveResidualGenerationRequest): Promise<StripeMarketplaceSuccessiveResidualGenerationObservation> {
    try {
      const request = structuredClone(untrusted);
      this.account(request.environment, request.accountFingerprint);
      if (hash(request) !== hash(buildStripeMarketplaceSuccessiveResidualGenerationRequest(request.basis, request.residualPlanId))) return { state: "unknown" };
      const native = await this.sources.certifyCompletedRefundForResidual(request.basis);
      if (native.state !== "confirmed") return { state: "unknown" };
      const raw = { version: 1 as const, kind: "stripe_v4_successive_residual_certified" as const, requestHash: request.requestHash,
        basisHash: request.basisHash, allocationHash: request.allocationHash, accountFingerprint: request.accountFingerprint,
        providerRefundId: request.basis.completedRefund.providerOperationId, observedAt: new Date().toISOString(),
        sourceInventoryComplete: true as const, transferReceipts: [...native.transferReceipts].sort((a, b) => a.requestHash.localeCompare(b.requestHash)) };
      const proof = { ...raw, proofHash: hash(raw) };
      return validStripeSuccessiveResidualGenerationProof(request, proof) ? { state: "confirmed", proof } : { state: "unknown" };
    } catch { return { state: "unknown" }; }
  }
}
