export interface MarketplaceSellerPositiveFeeDisputeObligationEvidence {
  version: 1; reason: "stripe_seller_dispute_obligation_closed";
  debtId: string; feeCertificateId: string; feeCertificateHash: string;
  hostMerchantId: string; fundingPlanId: string; sellerMerchantId: string;
  providerDisputeId: string; closureSnapshotId: string; provider: "stripe";
  environment: "test" | "live"; accountFingerprint: string;
  principalAmountCents: number;
  /** This seller's proportional dispute cost, not the total account dispute fee. */
  disputeFeeCents: number; collectedFeeCents: number; processingFeeCents: number;
  excessLiabilityCents: 0; creditHashes: string[]; excessReturnHashes?: string[];
  fundingHoldReleased: false; payoutReauthorized: false;
}

/** Zero is a proven frozen allocation. No checkout, credit or processing fee exists. */
export interface MarketplaceSellerZeroFeeDisputeObligationEvidence extends Omit<MarketplaceSellerPositiveFeeDisputeObligationEvidence,
  "version" | "reason" | "disputeFeeCents" | "collectedFeeCents" | "processingFeeCents" | "creditHashes" | "excessReturnHashes"> {
  version: 2; reason: "stripe_seller_zero_fee_dispute_obligation_closed";
  disputeFeeCents: 0; collectedFeeCents: 0; processingFeeCents: 0; creditHashes: [];
}
export type MarketplaceSellerDisputeObligationEvidence = MarketplaceSellerPositiveFeeDisputeObligationEvidence | MarketplaceSellerZeroFeeDisputeObligationEvidence;
