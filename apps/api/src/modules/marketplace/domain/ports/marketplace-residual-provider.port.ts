import type { MarketplacePayoutRequest } from "./marketplace-payout-provider.port.js";

export interface MarketplaceResidualRequest extends MarketplacePayoutRequest {
  /** Omitted in the original pre-transfer contract. */
  version?: 2 | 3 | 4 | 5 | 6 | 7;
  sourceId?: string;
  sourceAllocation?: import("../services/marketplace-residual-sources.js").MarketplaceResidualAllocationV4;
  fundingContributions?: import("../services/marketplace-residual-sources.js").MarketplaceResidualContributionFunding;
  sourceTransfers?: Array<{ sourceId: string; transfers: Array<{ reference: string; destination: string; amountCents: number }> }>;
  /** Asaas V5 uses the original held principal and certified whole returns;
   * it never treats a processing fee or aggregate wallet balance as funding. */
  fundingPlanId?: string;
  beneficiaryMerchantId?: string;
  basisHash?: string;
  allocationHash?: string;
  asaasFunding?: import("../services/asaas-marketplace-residual.js").AsaasMarketplaceResidualFunding;
  residualAllocation?: import("../services/asaas-marketplace-residual.js").AsaasMarketplaceResidualAllocation |
    import("./asaas-marketplace-host-retention.port.js").AsaasMarketplaceHostRetentionAllocation;
  hostRetention?: { journalId: string; requestHash: string };
  stripeSuccessiveFunding?: import("./stripe-marketplace-successive-residual.port.js").StripeMarketplaceSuccessiveResidualRequest["stripeSuccessiveFunding"];
  originalTransfers?: import("../services/marketplace-residual-allocation.js").MarketplaceResidualOriginalTransfer[];
  previousGenerations?: import("../services/marketplace-residual-allocation.js").MarketplaceResidualPreviousGeneration[];
  capture: NonNullable<MarketplacePayoutRequest["capture"]>;
  requestHash: string;
  refunds: Array<{ providerOperationId: string; amountCents: number }>;
  /** Sum of all beneficiary residual transfers, not only this operation. */
  remainingTotalCents: number;
  transfers: Array<{ reference: string; destination: string; amountCents: number }>;
}
export interface MarketplaceResidualObservation {
  state: "unknown" | "pending" | "confirmed" | "failed";
  providerTransferId?: string;
  amountCents?: number;
  observedAt?: string;
  /** Asaas V5 terminal receipt keeps both native account ledger movements. */
  asaasProof?: import("./asaas-marketplace-residual.port.js").AsaasMarketplaceResidualTransferProof;
  /** The transfer receipt is proven, but its funding history now needs review. */
  reconciliationRequired?: boolean;
}
export interface MarketplaceResidualProvider {
  submit(request: MarketplaceResidualRequest): Promise<MarketplaceResidualObservation | { state: "not_submitted" }>;
  reconcile(request: MarketplaceResidualRequest, providerTransferId?: string): Promise<MarketplaceResidualObservation>;
}
