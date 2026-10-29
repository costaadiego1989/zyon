import type {MarketplaceContributionActor} from "./marketplace-refund-contribution-journal.port.js";
import type {MarketplaceDisputeBalanceEntry,MarketplaceDisputeClosureRequest,MarketplaceDisputeClosureProof} from "./marketplace-dispute-closure.port.js";

export interface MarketplaceHostPrincipalExtinctionEvidence {
  version:1;reason:"stripe_host_dispute_principal_extinguished";payoutId:string;hostMerchantId:string;fundingPlanId:string;
  providerDisputeId:string;closureSnapshotId:string;requestHash:string;proofHash:string;instructionsHash:string;budgetHash:string;
  provider:"stripe";environment:"test"|"live";accountFingerprint:string;providerPaymentId:string;sourceId:string;
  chargebackAt:string;providerTransferId:string;amountCents:number;withdrawal:MarketplaceDisputeBalanceEntry;reinstatement:MarketplaceDisputeBalanceEntry;
  disputeFeeCents:number;hostDisputeFeeCents:number;feeCollectionState:"uncollected";fundingHoldReleased:false;payoutReauthorized:false;
}
export interface MarketplaceOrderDisputePayoutReference {
  payoutId:string;beneficiaryMerchantId:string;kind:"seller_settlement"|"host_receivable";destination:string;amountCents:number;providerTransferId:string;
}
export interface MarketplaceOrderDisputeSellerReference {
  obligationId:string;debtId:string;payoutId:string;sellerMerchantId:string;feeCertificateId:string;feeCertificateHash:string;
  obligationEvidenceHash:string;principalAmountCents:number;disputeFeeCents:number;collectedFeeCents:number;processingFeeCents:number;creditHashes:string[];
}
export interface MarketplaceOrderDisputeClosureV1Evidence {
  version:1;reason:"stripe_order_dispute_closed";hostMerchantId:string;fundingPlanId:string;providerDisputeId:string;closureSnapshotId:string;
  requestHash:string;proofHash:string;instructionsHash:string;budgetHash:string;provider:"stripe";environment:"test"|"live";
  accountFingerprint:string;providerPaymentId:string;sourceId:string;chargebackAt:string;principalReinstatedCents:number;
  disputeFeeCents:number;hostDisputeFeeCents:0;collectedFeeCents:number;processingFeeCents:number;excessLiabilityCents:0;
  hostPrincipal:null|{certificateId:string;evidenceHash:string;payoutId:string;amountCents:number};
  sellerObligations:MarketplaceOrderDisputeSellerReference[];payouts:MarketplaceOrderDisputePayoutReference[];
  originalFundingStatus:"held";operationalHoldClosed:true;fundingHoldReleased:false;payoutReauthorized:false;
}
export interface MarketplaceOrderDisputeHostObligationReference {
  obligationId:string;payoutId:string;feeCertificateId:string;feeCertificateHash:string;obligationEvidenceHash:string;
  principalAmountCents:number;disputeFeeCents:number;collectedFeeCents:number;processingFeeCents:number;creditHashes:string[];
}
export interface MarketplaceOrderDisputeClosureV2Evidence extends Omit<MarketplaceOrderDisputeClosureV1Evidence,"version"|"hostDisputeFeeCents"> {
  version:2;hostDisputeFeeCents:number;hostObligation:MarketplaceOrderDisputeHostObligationReference;
}
/** Contains at least one proven zero fee allocation (or a globally zero fee).
 * Positive allocations still require their original collected-fee obligations. */
export interface MarketplaceOrderDisputeClosureV3Evidence extends Omit<MarketplaceOrderDisputeClosureV1Evidence,"version"|"hostDisputeFeeCents"> {
  version:3;hostDisputeFeeCents:number;hostObligation?:MarketplaceOrderDisputeHostObligationReference;
}
export type MarketplaceOrderDisputeClosureEvidence = MarketplaceOrderDisputeClosureV1Evidence | MarketplaceOrderDisputeClosureV2Evidence | MarketplaceOrderDisputeClosureV3Evidence;
export interface MarketplaceHostPrincipalExtinctionResult {
  status:"extinguished";certificateId:string;payoutId:string;fundingPlanId:string;extinguishedAmountCents:number;hostDisputeFeeCents:number;
  replay:boolean;fundingHoldReleased:false;payoutReauthorized:false;
}
export interface MarketplaceOrderDisputeClosureResult {
  status:"closed";certificateId:string;fundingPlanId:string;replay:boolean;originalFundingStatus:"held";
  operationalHoldClosed:true;fundingHoldReleased:false;payoutReauthorized:false;
}
export interface MarketplaceOrderDisputeClosureContext {
  fundingPlanId:string;providerDisputeId:string;environment:"test"|"live";hostPrincipalAmountCents:number;hostDisputeFeeCents:number;
  hostPrincipalExtinguished:boolean;hostPrincipalCertificateId?:string;orderClosed:boolean;orderCertificateId?:string;
  canExtinguishHostPrincipal:boolean;canCloseOrder:boolean;blockedReason?:string;
  originalFundingStatus:"held";operationalHoldClosed:boolean;fundingHoldReleased:false;payoutReauthorized:false;
}
export interface MarketplaceOrderDisputeClosureRepository {
  request(actor:MarketplaceContributionActor,paymentIntentId:string,providerDisputeId:string):Promise<MarketplaceDisputeClosureRequest>;
  context(actor:MarketplaceContributionActor,paymentIntentId:string,providerDisputeId:string):Promise<MarketplaceOrderDisputeClosureContext>;
  replayHostPrincipal(actor:MarketplaceContributionActor,paymentIntentId:string,providerDisputeId:string):Promise<MarketplaceHostPrincipalExtinctionResult|null>;
  replayClosure(actor:MarketplaceContributionActor,paymentIntentId:string,providerDisputeId:string):Promise<MarketplaceOrderDisputeClosureResult|null>;
  recordHostPrincipal(actor:MarketplaceContributionActor,request:MarketplaceDisputeClosureRequest,proof:MarketplaceDisputeClosureProof):Promise<MarketplaceHostPrincipalExtinctionResult>;
  recordClosure(actor:MarketplaceContributionActor,request:MarketplaceDisputeClosureRequest,proof:MarketplaceDisputeClosureProof):Promise<MarketplaceOrderDisputeClosureResult>;
}
export const MARKETPLACE_ORDER_DISPUTE_CLOSURE_REPOSITORY=Symbol("MARKETPLACE_ORDER_DISPUTE_CLOSURE_REPOSITORY");
