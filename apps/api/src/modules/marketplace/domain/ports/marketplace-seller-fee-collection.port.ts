import type { MarketplaceContributionActor, MarketplaceContributionCustomerProof, MarketplaceContributionCustomerScope } from "./marketplace-refund-contribution-journal.port.js";
import type { MarketplaceDisputeClosureRequest } from "./marketplace-dispute-closure.port.js";
import type { MarketplaceRefundContributionProof } from "./marketplace-refund-contribution.port.js";
import type { MarketplaceDebtPrincipalExtinctionPositiveFeeEvidence } from "../services/marketplace-debt-principal-extinction-positive-fee.js";
import type { MarketplaceFeeExcessJournal, MarketplaceFeeExcessRequest, MarketplaceFeeExcessOperation, MarketplaceFeeExcessObservation } from "./marketplace-fee-excess-return.port.js";

export interface MarketplaceSellerFeeCollectionApproval {
  debtId: string; collectionId: string; customerId: string; grossAmountCents: number; confirmed: true;
}
export type MarketplaceSellerFeeHostedApproval = Omit<MarketplaceSellerFeeCollectionApproval, "customerId">;
export interface MarketplaceSellerFeeCandidate {
  kind: "candidate"; debt_id: string; fee_certificate_id: string; environment: "test" | "live";
  due_cents: number; collected_cents: number; outstanding_cents: number; processing_fee_cents: number; excess_liability_cents: number;
  can_prepare: boolean; customer_setup_required: boolean;
  obligation_status: "outstanding" | "fees_collected_excess_held" | "closed";
  obligation_id?: string; obligation_can_close: boolean; funding_hold_released: false; payout_reauthorized: false;
}
export interface MarketplaceSellerFeeCollectionRequest {
  version: 1; reason: "marketplace_seller_dispute_fee_collection"; provider: "stripe"; method: "card"; currency: "BRL";
  environment: "test" | "live"; accountFingerprint: string;
  collectionId: string; debtId: string; feeCertificateId: string; feeCertificateHash: string;
  hostMerchantId: string; fundingPlanId: string; merchantId: string; actorUserId: string; customerId: string;
  feeEvidence: MarketplaceDebtPrincipalExtinctionPositiveFeeEvidence; disputeRequest: MarketplaceDisputeClosureRequest;
  grossAmountCents: number; maximumCreditCents: number; priorCreditHashes: string[];
  authorisedAt: string; expiresAt: number; reference: string; requestHash: string;
}
export interface MarketplaceSellerFeeIncomingProof extends Omit<MarketplaceRefundContributionProof, "request" | "paymentIntent"> {
  paymentIntent: Omit<MarketplaceRefundContributionProof["paymentIntent"], "metadata"> & { metadata: Record<string, string> };
  sessionId: string; requestHash: string;
}
export interface MarketplaceSellerFeeCredit {
  version: 1; reason: "marketplace_seller_dispute_fee_credit";
  request: MarketplaceSellerFeeCollectionRequest; proof: MarketplaceSellerFeeIncomingProof;
  creditCents: number; processingFeeCents: number; excessLiabilityCents: number; certificateHash: string;
}
export interface MarketplaceSellerFeeCollectionObservation {
  state: "open" | "paid" | "expired" | "unknown"; sessionId?: string; paymentIntentId?: string; checkoutUrl?: string;
  observedAt?: string; requestHash?: string; session?: unknown; credit?: MarketplaceSellerFeeCredit;
}
export type MarketplaceSellerFeeCollectionStatus = "approved" | "creating" | "open" | "paid" | "credited" | "expired" | "unproven";
export interface MarketplaceSellerFeeCollectionJournal extends MarketplaceFeeExcessJournal {
  id: string; status: MarketplaceSellerFeeCollectionStatus; version: number; request: MarketplaceSellerFeeCollectionRequest;
  sessionId?: string; paymentIntentId?: string; checkoutUrl?: string; credit?: MarketplaceSellerFeeCredit;
}
export interface MarketplaceSellerFeeContext {
  debtId: string; feeCertificateId: string; environment: "test" | "live";
  dueCents: number; collectedCents: number; outstandingCents: number; processingFeeCents: number; excessLiabilityCents: number;
  canPrepare: boolean; fundingHoldReleased: false; payoutReauthorized: false;
  obligationStatus: "outstanding" | "fees_collected_excess_held" | "closed";
  obligationId?: string; pendingFeeCents: number; obligationCanClose: boolean;
}
export interface MarketplaceSellerDisputeObligationResult {
  status: "closed"; obligationId: string; debtId: string; replay: boolean;
  fundingHoldReleased: false; payoutReauthorized: false;
}
export interface MarketplaceSellerFeeCollectionProvider {
  customer(scope: MarketplaceContributionCustomerScope): Promise<MarketplaceContributionCustomerProof | undefined>;
  submit(request: MarketplaceSellerFeeCollectionRequest): Promise<MarketplaceSellerFeeCollectionObservation>;
  observe(request: MarketplaceSellerFeeCollectionRequest, sessionId?: string): Promise<MarketplaceSellerFeeCollectionObservation>;
  submitExcess(request: MarketplaceFeeExcessRequest): Promise<MarketplaceFeeExcessObservation>;
  observeExcess(request: MarketplaceFeeExcessRequest, providerRefundId?: string): Promise<MarketplaceFeeExcessObservation>;
}
export interface MarketplaceSellerFeeCollectionRepository {
  context(actor: MarketplaceContributionActor, debtId: string): Promise<MarketplaceSellerFeeContext>;
  dashboardContext(actor: MarketplaceContributionActor, debtId: string): Promise<MarketplaceSellerFeeCandidate>;
  candidates(actor: MarketplaceContributionActor, limit: number, cursor?: string): Promise<{ items: MarketplaceSellerFeeCandidate[]; nextCursor?: string }>;
  hostedCustomerId(actor: MarketplaceContributionActor, debtId: string): Promise<string | undefined>;
  customerScope(actor: MarketplaceContributionActor, input: MarketplaceSellerFeeCollectionApproval): Promise<MarketplaceContributionCustomerScope>;
  prepare(actor: MarketplaceContributionActor, input: MarketplaceSellerFeeCollectionApproval, proof: MarketplaceContributionCustomerProof): Promise<MarketplaceSellerFeeCollectionJournal>;
  get(actor: MarketplaceContributionActor, collectionId: string): Promise<MarketplaceSellerFeeCollectionJournal>;
  claim(actor: MarketplaceContributionActor, collectionId: string, grossAmountCents: number): Promise<MarketplaceSellerFeeCollectionJournal | undefined>;
  claimExcess(actor: MarketplaceContributionActor, collectionId: string, amountCents: number, recovery: boolean): Promise<MarketplaceFeeExcessOperation | undefined>;
  recordExcess(actor: MarketplaceContributionActor, operation: MarketplaceFeeExcessOperation, observation: MarketplaceFeeExcessObservation): Promise<MarketplaceSellerFeeCollectionJournal>;
  cancel(actor: MarketplaceContributionActor, collectionId: string): Promise<MarketplaceSellerFeeCollectionJournal>;
  record(actor: MarketplaceContributionActor, collectionId: string, observation: MarketplaceSellerFeeCollectionObservation): Promise<MarketplaceSellerFeeCollectionJournal>;
  list(actor: MarketplaceContributionActor, debtId: string, limit: number, cursor?: string): Promise<{ items: MarketplaceSellerFeeCollectionJournal[]; nextCursor?: string }>;
  unresolved(limit: number): Promise<Array<{ actor: MarketplaceContributionActor; collectionId: string }>>;
  closeObligation(actor: MarketplaceContributionActor, debtId: string): Promise<MarketplaceSellerDisputeObligationResult>;
  unclosedObligations(limit: number): Promise<Array<{ actor: MarketplaceContributionActor; debtId: string }>>;
}
export const MARKETPLACE_SELLER_FEE_COLLECTION_REPOSITORY = Symbol("MARKETPLACE_SELLER_FEE_COLLECTION_REPOSITORY");
export const MARKETPLACE_SELLER_FEE_COLLECTION_PROVIDER = Symbol("MARKETPLACE_SELLER_FEE_COLLECTION_PROVIDER");
