import type { MarketplaceResidualBasisV1, MarketplaceResidualPreviousGeneration } from "../services/marketplace-residual-allocation.js";
import type { MarketplacePayoutRequest } from "./marketplace-payout-provider.port.js";
import type { StripeMarketplaceSourceRefundFunding, StripeMarketplaceSourceRefundHistory } from "./marketplace-stripe-source-refund.port.js";

/** A V4 successor spends only the cash causally retained for that beneficiary.
 * Existing net transfers remain paid. No new seller funding is inferred. */
export interface StripeMarketplaceSuccessiveResidualBasis extends Omit<MarketplaceResidualBasisV1, "version"> {
  version: 6;
  kind: "stripe_v4_successive_residual";
  sourceRefundFunding: StripeMarketplaceSourceRefundFunding;
  completedRefund: StripeMarketplaceSourceRefundHistory & { requestHash: string; amountCents: number };
  previousGenerations: MarketplaceResidualPreviousGeneration[];
}
export interface StripeMarketplaceSuccessiveResidualAllocation {
  version: 6;
  kind: "stripe_v4_successive_residual";
  capturedNetCents: number;
  contributedNetCents: number;
  contributionProcessingFeeCents: number;
  excessLiabilityCents: number;
  refundedCents: number;
  platformRetainedCents: number;
  alreadyTransferredCents: number;
  payoutTotalCents: number;
  beneficiaries: Array<{ merchantId: string; destination: string; amountCents: number;
    providerFeeCents: number; alreadyTransferredCents: number; remainingEntitlementCents: number }>;
  sources: Array<{ sourceId: string; chargeId: string; balanceTransactionId: string; capturedGrossCents: number;
    processingFeeCents: number; creditedNetCents: number; refundedCents: number; platformRetainedCents: number;
    grossTransferredCents: number; alreadyTransferredCents: number; availableCents: number; payoutTotalCents: number;
    beneficiaries: Array<{ merchantId: string; destination: string; amountCents: number }> }>;
}
export interface StripeMarketplaceSuccessiveResidualRequest extends MarketplacePayoutRequest {
  version: 6;
  requestHash: string;
  sourceId: string;
  beneficiaryMerchantId: string;
  basisHash: string;
  allocationHash: string;
  stripeSuccessiveFunding: { basis: StripeMarketplaceSuccessiveResidualBasis; allocation: StripeMarketplaceSuccessiveResidualAllocation };
  capture: NonNullable<MarketplacePayoutRequest["capture"]>;
  refunds: Array<{ providerOperationId: string; amountCents: number }>;
  remainingTotalCents: number;
  transfers: Array<{ reference: string; destination: string; amountCents: number }>;
}
export interface StripeMarketplaceSuccessiveResidualGenerationRequest {
  version: 1;
  kind: "stripe_v4_successive_residual_certification";
  provider: "stripe";
  environment: "test" | "live";
  accountFingerprint: string;
  hostMerchantId: string;
  fundingPlanId: string;
  residualPlanId: string;
  generation: 2;
  basis: StripeMarketplaceSuccessiveResidualBasis;
  basisHash: string;
  allocation: StripeMarketplaceSuccessiveResidualAllocation;
  allocationHash: string;
  reference: string;
  requestHash: string;
}
export interface StripeMarketplaceSuccessiveResidualTransferReceipt {
  sourceId: string;
  merchantId: string;
  reference: string;
  requestHash: string;
  providerTransferId: string;
  chargeId: string;
  destination: string;
  amountCents: number;
  /** Actual native platform debit, separately observed after transfer. */
  balance: { id: string; sourceId: string; type: "transfer"; currency: "BRL"; status: "available";
    amountCents: number; feeCents: 0; netCents: number };
}
export interface StripeMarketplaceSuccessiveResidualGenerationProof {
  version: 1;
  kind: "stripe_v4_successive_residual_certified";
  requestHash: string;
  basisHash: string;
  allocationHash: string;
  accountFingerprint: string;
  providerRefundId: string;
  observedAt: string;
  /** Complete GET certification of original charge, all certified fee sources,
   * buyer refunds and old reversals, including the current buyer receipt. */
  sourceInventoryComplete: true;
  transferReceipts: StripeMarketplaceSuccessiveResidualTransferReceipt[];
  proofHash: string;
}
export type StripeMarketplaceSuccessiveResidualGenerationObservation =
  { state: "unknown" } | { state: "confirmed"; proof: StripeMarketplaceSuccessiveResidualGenerationProof };
export interface StripeMarketplaceSuccessiveResidualGenerationOperation {
  operationId: string;
  hostMerchantId: string;
  residualPlanId: string;
  version: number;
  state: "planned" | "unknown" | "confirmed";
  request: StripeMarketplaceSuccessiveResidualGenerationRequest;
}
export interface StripeMarketplaceSuccessiveResidualGenerationRepository {
  claimGeneration(hostMerchantId: string, residualPlanId: string, now: Date):
    Promise<StripeMarketplaceSuccessiveResidualGenerationOperation | undefined>;
  recordGeneration(operation: StripeMarketplaceSuccessiveResidualGenerationOperation,
    observation: StripeMarketplaceSuccessiveResidualGenerationObservation): Promise<boolean>;
  listUnresolvedGenerations(limit: number): Promise<Array<{ hostMerchantId: string; residualPlanId: string }>>;
}
export interface StripeMarketplaceSuccessiveResidualCertificationProvider {
  certifyGeneration(request: StripeMarketplaceSuccessiveResidualGenerationRequest): Promise<StripeMarketplaceSuccessiveResidualGenerationObservation>;
}
export const STRIPE_MARKETPLACE_SUCCESSIVE_RESIDUAL_GENERATION_REPOSITORY = Symbol("StripeMarketplaceSuccessiveResidualGenerationRepository");
export const STRIPE_MARKETPLACE_SUCCESSIVE_RESIDUAL_CERTIFICATION_PROVIDER = Symbol("StripeMarketplaceSuccessiveResidualCertificationProvider");
