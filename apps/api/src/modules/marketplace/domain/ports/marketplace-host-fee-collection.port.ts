import type { MarketplaceContributionActor, MarketplaceContributionCustomerProof, MarketplaceContributionCustomerScope } from "./marketplace-refund-contribution-journal.port.js";
import type { MarketplaceDisputeClosureRequest } from "./marketplace-dispute-closure.port.js";
import type { MarketplaceRefundContributionProof } from "./marketplace-refund-contribution.port.js";
import type { MarketplaceHostPrincipalExtinctionEvidence } from "./marketplace-order-dispute-closure.port.js";
import type { MarketplaceFeeExcessJournal, MarketplaceFeeExcessRequest, MarketplaceFeeExcessOperation, MarketplaceFeeExcessObservation } from "./marketplace-fee-excess-return.port.js";

/** Host debtId is the original host_receivable payoutId, never a seller debt ID. */
export interface MarketplaceHostFeeCollectionApproval {
  debtId: string; collectionId: string; customerId: string; grossAmountCents: number; confirmed: true;
}
export type MarketplaceHostFeeHostedApproval = Omit<MarketplaceHostFeeCollectionApproval, "customerId">;
export interface MarketplaceHostFeeCandidate {
  kind: "candidate"; debt_id: string; fee_certificate_id: string; environment: "test" | "live";
  due_cents: number; collected_cents: number; outstanding_cents: number; processing_fee_cents: number; excess_liability_cents: number;
  can_prepare: boolean; customer_setup_required: boolean;
  obligation_status: "outstanding" | "fees_collected_excess_held" | "closed";
  obligation_id?: string; obligation_can_close: boolean; funding_hold_released: false; payout_reauthorized: false;
}
export interface MarketplaceHostFeeCollectionRequest {
  version: 1; reason: "marketplace_host_dispute_fee_collection"; provider: "stripe"; method: "card"; currency: "BRL";
  environment: "test" | "live"; accountFingerprint: string;
  collectionId: string; debtId: string; feeCertificateId: string; feeCertificateHash: string;
  hostMerchantId: string; fundingPlanId: string; merchantId: string; actorUserId: string; customerId: string;
  feeEvidence: MarketplaceHostPrincipalExtinctionEvidence; disputeRequest: MarketplaceDisputeClosureRequest;
  grossAmountCents: number; maximumCreditCents: number; priorCreditHashes: string[];
  authorisedAt: string; expiresAt: number; reference: string; requestHash: string;
}
export interface MarketplaceHostFeeIncomingProof extends Omit<MarketplaceRefundContributionProof, "request" | "paymentIntent"> {
  paymentIntent: Omit<MarketplaceRefundContributionProof["paymentIntent"], "metadata"> & { metadata: Record<string, string> };
  sessionId: string; requestHash: string;
}
export interface MarketplaceHostFeeCredit {
  version: 1; reason: "marketplace_host_dispute_fee_credit";
  request: MarketplaceHostFeeCollectionRequest; proof: MarketplaceHostFeeIncomingProof;
  creditCents: number; processingFeeCents: number; excessLiabilityCents: number; certificateHash: string;
}
export interface MarketplaceHostFeeCollectionObservation {
  state: "open" | "paid" | "expired" | "unknown"; sessionId?: string; paymentIntentId?: string; checkoutUrl?: string;
  observedAt?: string; requestHash?: string; session?: unknown; credit?: MarketplaceHostFeeCredit;
}
export type MarketplaceHostFeeCollectionStatus = "approved" | "creating" | "open" | "paid" | "credited" | "expired" | "unproven";
export interface MarketplaceHostFeeCollectionJournal extends MarketplaceFeeExcessJournal {
  id: string; status: MarketplaceHostFeeCollectionStatus; version: number; request: MarketplaceHostFeeCollectionRequest;
  sessionId?: string; paymentIntentId?: string; checkoutUrl?: string; credit?: MarketplaceHostFeeCredit;
}
export interface MarketplaceHostFeeContext {
  debtId: string; feeCertificateId: string; environment: "test" | "live";
  dueCents: number; collectedCents: number; outstandingCents: number; processingFeeCents: number; excessLiabilityCents: number;
  canPrepare: boolean; fundingHoldReleased: false; payoutReauthorized: false;
  obligationStatus: "outstanding" | "fees_collected_excess_held" | "closed";
  obligationId?: string; pendingFeeCents: number; obligationCanClose: boolean;
}
export interface MarketplaceHostDisputeObligationResult {
  status: "closed"; obligationId: string; debtId: string; replay: boolean;
  fundingHoldReleased: false; payoutReauthorized: false;
}
export interface MarketplaceHostFeeCollectionProvider {
  customer(scope: MarketplaceContributionCustomerScope): Promise<MarketplaceContributionCustomerProof | undefined>;
  submit(request: MarketplaceHostFeeCollectionRequest): Promise<MarketplaceHostFeeCollectionObservation>;
  observe(request: MarketplaceHostFeeCollectionRequest, sessionId?: string): Promise<MarketplaceHostFeeCollectionObservation>;
  submitExcess(request: MarketplaceFeeExcessRequest): Promise<MarketplaceFeeExcessObservation>;
  observeExcess(request: MarketplaceFeeExcessRequest, providerRefundId?: string): Promise<MarketplaceFeeExcessObservation>;
}
export interface MarketplaceHostFeeCollectionRepository {
  context(actor: MarketplaceContributionActor, debtId: string): Promise<MarketplaceHostFeeContext>;
  dashboardContext(actor: MarketplaceContributionActor, debtId: string): Promise<MarketplaceHostFeeCandidate>;
  candidates(actor: MarketplaceContributionActor, limit: number, cursor?: string): Promise<{ items: MarketplaceHostFeeCandidate[]; nextCursor?: string }>;
  hostedCustomerId(actor: MarketplaceContributionActor, debtId: string): Promise<string | undefined>;
  customerScope(actor: MarketplaceContributionActor, input: MarketplaceHostFeeCollectionApproval): Promise<MarketplaceContributionCustomerScope>;
  prepare(actor: MarketplaceContributionActor, input: MarketplaceHostFeeCollectionApproval, proof: MarketplaceContributionCustomerProof): Promise<MarketplaceHostFeeCollectionJournal>;
  get(actor: MarketplaceContributionActor, collectionId: string): Promise<MarketplaceHostFeeCollectionJournal>;
  claim(actor: MarketplaceContributionActor, collectionId: string, grossAmountCents: number): Promise<MarketplaceHostFeeCollectionJournal | undefined>;
  claimExcess(actor: MarketplaceContributionActor, collectionId: string, amountCents: number, recovery: boolean): Promise<MarketplaceFeeExcessOperation | undefined>;
  recordExcess(actor: MarketplaceContributionActor, operation: MarketplaceFeeExcessOperation, observation: MarketplaceFeeExcessObservation): Promise<MarketplaceHostFeeCollectionJournal>;
  cancel(actor: MarketplaceContributionActor, collectionId: string): Promise<MarketplaceHostFeeCollectionJournal>;
  record(actor: MarketplaceContributionActor, collectionId: string, observation: MarketplaceHostFeeCollectionObservation): Promise<MarketplaceHostFeeCollectionJournal>;
  list(actor: MarketplaceContributionActor, debtId: string, limit: number, cursor?: string): Promise<{ items: MarketplaceHostFeeCollectionJournal[]; nextCursor?: string }>;
  unresolved(limit: number): Promise<Array<{ actor: MarketplaceContributionActor; collectionId: string }>>;
  closeObligation(actor: MarketplaceContributionActor, debtId: string): Promise<MarketplaceHostDisputeObligationResult>;
  unclosedObligations(limit: number): Promise<Array<{ actor: MarketplaceContributionActor; debtId: string }>>;
}
export const MARKETPLACE_HOST_FEE_COLLECTION_REPOSITORY = Symbol("MARKETPLACE_HOST_FEE_COLLECTION_REPOSITORY");
export const MARKETPLACE_HOST_FEE_COLLECTION_PROVIDER = Symbol("MARKETPLACE_HOST_FEE_COLLECTION_PROVIDER");

export interface MarketplaceHostDisputeObligationEvidence {
 version:1; reason:"stripe_host_dispute_obligation_closed"; debtId:string; payoutId:string;
 feeCertificateId:string; feeCertificateHash:string; hostMerchantId:string; fundingPlanId:string;
 providerDisputeId:string; closureSnapshotId:string; provider:"stripe"; environment:"test"|"live"; accountFingerprint:string;
 principalAmountCents:number; disputeFeeCents:number; collectedFeeCents:number; processingFeeCents:number;
 excessLiabilityCents:0; creditHashes:string[]; excessReturnHashes?:string[]; fundingHoldReleased:false; payoutReauthorized:false;
}
