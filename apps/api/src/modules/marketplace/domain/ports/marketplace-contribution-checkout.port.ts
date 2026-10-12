import type { MarketplaceContributionActor, MarketplaceContributionCustomerProof } from "./marketplace-refund-contribution-journal.port.js";
import type { MarketplaceRefundContributionCertificate } from "./marketplace-refund-contribution.port.js";
export interface MarketplaceContributionCheckoutApproval {
  refundPlanId: string; contributionId: string; grossAmountCents: number; confirmed: true; customerId?: string;
}
export interface MarketplaceContributionCheckoutRequest {
  version: 1; reason: "refund_processing_fee_contribution"; provider: "stripe"; environment: "test" | "live";
  accountFingerprint: string; currency: "BRL"; method: "card";
  contributionId: string; fundingPlanId: string; hostMerchantId: string; refundPlanId: string; merchantId: string;
  actorUserId: string; customerId: string; grossAmountCents: number; maximumCreditCents: number;
  originalPaymentIntentId: string; originalChargeId: string; originalAmountCents: number; originalRefundedAmountCents: number;
  planHash: string; authorisedAt: string; expiresAt: number; reference: string; requestHash: string;
}
export interface MarketplaceContributionCheckoutObservation {
  state: "open" | "paid" | "expired" | "unknown"; sessionId?: string; paymentIntentId?: string; checkoutUrl?: string;
  observedAt?: string; requestHash?: string; session?: unknown;
}
export interface MarketplaceContributionCheckoutJournal {
  id: string; status: "approved" | "creating" | "open" | "paid" | "credited" | "expired" | "unproven";
  version: number; request: MarketplaceContributionCheckoutRequest;
  sessionId?: string; paymentIntentId?: string; checkoutUrl?: string;
  creditedNetCents?: number; processingFeeCents?: number; excessLiabilityCents?: number;
  returnedExcessCents?: number; excessStatus?: "held" | "unknown" | "pending" | "returned" | "failed"; canReturnExcess?: boolean;
  /** A durable, independently verified credit may precede local Checkout sync. */
  creditCertified?: boolean;
}
export interface MarketplaceContributionCheckoutCandidate {
  refund_plan_id: string; environment: "test" | "live"; required_net_cents: number; outstanding_net_cents: number;
  customer_setup_required: boolean; can_create: boolean; block_reason?: string;
}
export interface MarketplaceContributionExcessRequest {
  contributionId: string; hostMerchantId: string; fundingPlanId: string; merchantId: string;
  accountFingerprint: string; environment: "test" | "live"; amountCents: number;
  certificate: MarketplaceRefundContributionCertificate; originalAmountCents: number;
  reference: string; requestHash: string;
}
export interface MarketplaceContributionExcessObservation { state: "confirmed" | "pending" | "unknown" | "failed"; providerRefundId?: string; amountCents?: number; proof?: unknown }
export interface MarketplaceContributionExcessOperation { request: MarketplaceContributionExcessRequest; version: number; submit: boolean; providerRefundId?: string }
export interface MarketplaceContributionCheckoutProvider {
  submit(request: MarketplaceContributionCheckoutRequest): Promise<MarketplaceContributionCheckoutObservation>;
  observe(request: MarketplaceContributionCheckoutRequest, sessionId?: string): Promise<MarketplaceContributionCheckoutObservation>;
  submitExcess(request: MarketplaceContributionExcessRequest): Promise<MarketplaceContributionExcessObservation>;
  observeExcess(request: MarketplaceContributionExcessRequest, providerRefundId?: string): Promise<MarketplaceContributionExcessObservation>;
}
export interface MarketplaceContributionCheckoutRepository {
  customerScope(actor: MarketplaceContributionActor, refundPlanId: string, customerId?: string): Promise<{ merchantId: string; customerId: string; environment: "test" | "live"; accountFingerprint: string }>;
  prepare(actor: MarketplaceContributionActor, input: MarketplaceContributionCheckoutApproval, customer: MarketplaceContributionCustomerProof): Promise<MarketplaceContributionCheckoutJournal>;
  get(actor: MarketplaceContributionActor, contributionId: string): Promise<MarketplaceContributionCheckoutJournal>;
  claim(actor: MarketplaceContributionActor, contributionId: string, expectedGrossAmountCents: number): Promise<MarketplaceContributionCheckoutJournal | undefined>;
  cancel(actor: MarketplaceContributionActor, contributionId: string): Promise<MarketplaceContributionCheckoutJournal>;
  record(actor: MarketplaceContributionActor, contributionId: string, observation: MarketplaceContributionCheckoutObservation): Promise<MarketplaceContributionCheckoutJournal>;
  reconcileCredit(actor: MarketplaceContributionActor, contributionId: string): Promise<void>;
  claimExcess(actor: MarketplaceContributionActor, contributionId: string, expectedAmountCents: number, reconcileOnly: boolean): Promise<MarketplaceContributionExcessOperation | undefined>;
  recordExcess(actor: MarketplaceContributionActor, operation: MarketplaceContributionExcessOperation, observation: MarketplaceContributionExcessObservation): Promise<void>;
  listUnresolved(limit: number): Promise<Array<{ actor: MarketplaceContributionActor; contributionId: string }>>;
  context(actor: MarketplaceContributionActor, refundPlanId: string): Promise<MarketplaceContributionCheckoutCandidate>;
  list(actor: MarketplaceContributionActor, limit: number, cursor?: string): Promise<{ items: Array<MarketplaceContributionCheckoutJournal | MarketplaceContributionCheckoutCandidate>; nextCursor?: string }>;
}
export const MARKETPLACE_CONTRIBUTION_CHECKOUT_PROVIDER = Symbol("MARKETPLACE_CONTRIBUTION_CHECKOUT_PROVIDER");
export const MARKETPLACE_CONTRIBUTION_CHECKOUT_REPOSITORY = Symbol("MARKETPLACE_CONTRIBUTION_CHECKOUT_REPOSITORY");
