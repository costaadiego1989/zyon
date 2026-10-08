import type { MarketplaceHostFeeCollectionProvider, MarketplaceHostFeeCollectionRequest, MarketplaceHostFeeCredit } from "../domain/ports/marketplace-host-fee-collection.port.js";
import { buildHostFeeCredit, hostFeeMetadata, hostFeeSessionObservation, validHostFeeCollection } from "../domain/services/marketplace-host-fee-collection.js";
import { allocateMarketplaceDisputeFee, marketplaceDisputeClosureProofHash } from "../domain/services/marketplace-dispute-closure-evidence.js";
import { marketplaceContributionHash } from "../domain/services/marketplace-refund-contribution.js";
import { StripeMarketplaceFeeCollectionTransport } from "./stripe-marketplace-fee-collection.transport.js";
import type { MarketplaceFeeExcessRequest } from "../domain/ports/marketplace-fee-excess-return.port.js";
import { StripeMarketplaceFeeExcessReturnTransport } from "./stripe-marketplace-fee-excess-return.transport.js";

/** A new host-authorized incoming payment certifies credit. The original platform fee debit proves liability only. */
export class StripeMarketplaceHostFeeCollectionAdapter extends StripeMarketplaceFeeCollectionTransport<MarketplaceHostFeeCollectionRequest, MarketplaceHostFeeCredit> implements MarketplaceHostFeeCollectionProvider {
  private readonly excess: StripeMarketplaceFeeExcessReturnTransport;
  constructor(config: { stripeSecret?: string; returnUrl: string }, request: typeof fetch = globalThis.fetch) {
    super(config, request, {
      valid: validHostFeeCollection, metadata: hostFeeMetadata, session: hostFeeSessionObservation, credit: buildHostFeeCredit,
      returnHash: "marketplace-host-fees", returnParameter: "host_fee_collection_id",
      originalFee(r, p) {
        const e = r.feeEvidence;
        return !!p && p.status === "won" && p.principalWithdrawnCents === r.disputeRequest.amountCents &&
          p.principalReinstatedCents === r.disputeRequest.amountCents && p.providerFeeCents === e.disputeFeeCents &&
          p.balanceDeltaCents === -e.disputeFeeCents && marketplaceDisputeClosureProofHash(p) === e.proofHash &&
          marketplaceContributionHash(p.entries.find(row => row.kind === "principal_withdrawal")) === marketplaceContributionHash(e.withdrawal) &&
          marketplaceContributionHash(p.entries.find(row => row.kind === "principal_reinstatement")) === marketplaceContributionHash(e.reinstatement) &&
          !p.entries.some(row => row.balanceTransactionId === r.disputeRequest.captureBalanceTransactionId) &&
          allocateMarketplaceDisputeFee(r.disputeRequest, p.providerFeeCents).find(row => row.sellerMerchantId === r.hostMerchantId)?.feeCents === e.hostDisputeFeeCents;
      },
    });
    this.excess = new StripeMarketplaceFeeExcessReturnTransport("host", config, request);
  }
  submitExcess(request: MarketplaceFeeExcessRequest) { return this.excess.submitExcess(request); }
  observeExcess(request: MarketplaceFeeExcessRequest, providerRefundId?: string) { return this.excess.observeExcess(request, providerRefundId); }
}

