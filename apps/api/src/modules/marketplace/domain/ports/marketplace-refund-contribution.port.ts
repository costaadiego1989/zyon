/** A separately authorised seller payment, read from the original collection
 * account. This contract never authorises a seller-account debit or a transfer.
 * The repository must bind customer/authorisation to the authenticated merchant,
 * fence payouts, and reserve PI/charge/balance IDs globally across orders. */
export interface MarketplaceRefundContributionRequest {
  version: 1;
  reason: "refund_processing_fee_contribution";
  provider: "stripe";
  method: "card";
  environment: "test" | "live";
  currency: "BRL";
  accountFingerprint: string;
  fundingPlanId: string;
  hostMerchantId: string;
  refundPlanId: string;
  merchantId: string;
  sellerDestination: string;
  instructionsHash: string;
  budgetHash: string;
  planHash: string;
  originalPaymentIntentId: string;
  originalChargeId: string;
  originalBalanceTransactionId: string;
  contributionId: string;
  customerId: string;
  authorisationId: string;
  /** Explicit approval for this payment, not an inferred auto-debit mandate. */
  authorisedAt: string;
  providerPaymentIntentId: string;
  grossAmountCents: number;
  /** Credit is the independently verified available net, capped by this deficit. */
  maximumCreditCents: number;
  reference: string;
  requestHash: string;
  /** A first-party hosted payment carries its creation hash before Stripe
   * assigns a PI. The immutable checkout journal supplies this binding. */
  collection?: { journalId: string; requestHash: string; reference: string };
}

/** Fields are normalised from independent GETs and a complete refund read;
 * copying caller-supplied metadata or accepting a webhook alone is insufficient. */
export interface MarketplaceRefundContributionProof {
  request: MarketplaceRefundContributionRequest;
  provider: "stripe";
  /** Computed from the account actually used for these independent GETs. */
  accountFingerprint: string;
  observedAt: string;
  paymentIntent: {
    id: string; status: "succeeded"; amountCents: number; receivedAmountCents: number;
    currency: "BRL"; environment: "test" | "live"; customerId: string; latestChargeId: string;
    applicationFeeCents: null; onBehalfOf: null; transferDestination: null;
    metadata: { reason: "refund_processing_fee_contribution"; contributionId: string;
      fundingPlanId: string; refundPlanId: string; merchantId: string; requestHash: string; reference: string };
  };
  charge: {
    id: string; paymentIntentId: string; customerId: string; amountCents: number;
    paymentMethodType: "card";
    currency: "BRL"; environment: "test" | "live"; status: "succeeded";
    paid: true; captured: true; disputed: false; refundedAmountCents: 0;
    refundsComplete: true; refundIds: string[]; balanceTransactionId: string;
    transferId: null; applicationFeeCents: null;
  };
  balance: {
    id: string; sourceId: string; type: "charge"; status: "available";
    currency: "BRL"; amountCents: number; feeCents: number; netCents: number;
  };
}

export interface MarketplaceRefundContributionCertificate {
  version: 1;
  reason: "refund_processing_fee_contribution_credit";
  request: MarketplaceRefundContributionRequest;
  proof: MarketplaceRefundContributionProof;
  creditCents: number;
  processingFeeCents: number;
  /** Available net beyond this order's fee deficit remains this seller's money. */
  excessLiabilityCents?: number;
  certificateHash: string;
}

/** GET-only. Pending, unavailable, refunded, disputed or unbound receipts cannot
 * become available funds. No submission/retry operation is exposed here. */
export interface MarketplaceRefundContributionProvider {
  readContribution(request: MarketplaceRefundContributionRequest): Promise<MarketplaceRefundContributionProof | undefined>;
}

export const MARKETPLACE_REFUND_CONTRIBUTION_PROVIDER = Symbol("MARKETPLACE_REFUND_CONTRIBUTION_PROVIDER");
