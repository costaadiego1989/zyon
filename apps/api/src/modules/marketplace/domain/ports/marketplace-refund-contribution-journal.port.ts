import type { MarketplaceRefundContributionCertificate, MarketplaceRefundContributionProvider, MarketplaceRefundContributionRequest } from "./marketplace-refund-contribution.port.js";

export interface MarketplaceContributionActor { merchantId: string; userId: string }
export interface MarketplaceContributionApproval {
  refundPlanId: string; contributionId: string; customerId: string;
  providerPaymentIntentId: string; grossAmountCents: number; confirmed: true;
  collection?: MarketplaceRefundContributionRequest["collection"];
}
export interface MarketplaceContributionCustomerScope {
  merchantId: string; customerId: string; environment: "test" | "live"; accountFingerprint: string;
}
export interface MarketplaceContributionCustomerProof extends MarketplaceContributionCustomerScope { observedAt: string }
export interface MarketplaceContributionJournal {
  id: string; hostMerchantId: string; refundPlanId: string; merchantId: string;
  status: "approved" | "observing" | "unproven" | "credited";
  version: number; claimToken?: string; request: MarketplaceRefundContributionRequest;
  certificate?: MarketplaceRefundContributionCertificate;
}
export interface MarketplaceContributionReceiptProvider extends MarketplaceRefundContributionProvider {
  readCustomerBinding(scope: MarketplaceContributionCustomerScope): Promise<MarketplaceContributionCustomerProof | undefined>;
}
/** The approval is human consent to a separate receipt import, never a debit mandate.
 * A claim leases GET observation only. Crediting always rechecks the original order. */
export interface MarketplaceRefundContributionJournalRepository {
  approvalContext(actor: MarketplaceContributionActor, approval: MarketplaceContributionApproval): Promise<MarketplaceContributionCustomerScope>;
  approve(actor: MarketplaceContributionActor, approval: MarketplaceContributionApproval, customer: MarketplaceContributionCustomerProof): Promise<MarketplaceContributionJournal>;
  get(actor: MarketplaceContributionActor, contributionId: string): Promise<MarketplaceContributionJournal>;
  claim(actor: MarketplaceContributionActor, contributionId: string): Promise<MarketplaceContributionJournal | undefined>;
  record(operation: MarketplaceContributionJournal, certificate: MarketplaceRefundContributionCertificate): Promise<MarketplaceContributionJournal>;
  release(operation: MarketplaceContributionJournal): Promise<void>;
  listUnresolved(limit: number): Promise<Array<{ actor: MarketplaceContributionActor; contributionId: string }>>;
}
export const MARKETPLACE_REFUND_CONTRIBUTION_JOURNAL = Symbol("MARKETPLACE_REFUND_CONTRIBUTION_JOURNAL");
export const MARKETPLACE_REFUND_CONTRIBUTION_ACTIVATOR = Symbol("MARKETPLACE_REFUND_CONTRIBUTION_ACTIVATOR");
export type MarketplaceContributionActivator = (hostMerchantId: string, refundPlanId: string) => Promise<unknown>;
