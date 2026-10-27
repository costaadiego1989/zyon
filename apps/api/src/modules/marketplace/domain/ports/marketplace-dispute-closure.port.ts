import type { MarketplaceFeeLine } from "../services/marketplace-provider-fee-allocation.js";

export interface MarketplaceDisputeClosureRequest {
  version: 1;
  hostMerchantId: string;
  paymentIntentId: string;
  checkoutSessionId: string;
  instructionsHash: string;
  budgetHash: string;
  provider: "stripe";
  environment: "test" | "live";
  accountFingerprint: string;
  providerPaymentId: string;
  sourceId: string;
  captureBalanceTransactionId: string;
  captureFeeCents: number;
  captureNetCents: number;
  providerDisputeId: string;
  amountCents: number;
  currency: "BRL";
  feePolicy: "proportional_seller_sales_v1";
  sales: MarketplaceFeeLine[];
  requestHash: string;
}

export interface MarketplaceDisputeBalanceEntry {
  balanceTransactionId: string;
  kind: "principal_withdrawal" | "principal_reinstatement";
  amountCents: number;
  feeCents: number;
  netCents: number;
  created: number;
  availableOn: number;
}

/** Proof of account ledger movements, not transfer recovery, refund consumption,
 * a contribution, collection from a seller, or permission to release a hold. */
export interface MarketplaceDisputeClosureProof {
  version: 1;
  requestHash: string;
  provider: "stripe";
  environment: "test" | "live";
  accountFingerprint: string;
  providerPaymentId: string;
  sourceId: string;
  providerDisputeId: string;
  status: "won" | "lost";
  amountCents: number;
  currency: "BRL";
  principalWithdrawnCents: number;
  principalReinstatedCents: number;
  providerFeeCents: number;
  balanceDeltaCents: number;
  entries: MarketplaceDisputeBalanceEntry[];
  observedAt: string;
}

export interface MarketplaceDisputeFeeLiability {
  sellerMerchantId: string;
  salesCents: number;
  feeCents: number;
  collectionState: "uncollected";
}

export interface MarketplaceDisputeClosureProvider {
  read(request: MarketplaceDisputeClosureRequest): Promise<MarketplaceDisputeClosureProof | null>;
}
export interface MarketplaceDisputePrincipalExtinctionInput {
  hostMerchantId: string;
  paymentIntentId: string;
  providerDisputeId: string;
  debtId: string;
}
export interface MarketplaceDisputePrincipalExtinctionResult {
  status: "extinguished";
  debtId: string;
  certificateId: string;
  extinguishedAmountCents: number;
  replay: boolean;
  fundingHoldReleased: false;
  payoutReauthorized: false;
}
export interface MarketplaceDisputeClosureRepository {
  request(hostMerchantId: string, paymentIntentId: string, providerDisputeId: string): Promise<MarketplaceDisputeClosureRequest>;
  record(request: MarketplaceDisputeClosureRequest, proof: MarketplaceDisputeClosureProof): Promise<{
    status: "won" | "lost"; principalWithdrawnCents: number; principalReinstatedCents: number;
    providerFeeCents: number; newEntries: number; replay: boolean;
  }>;
  /** Separate command; observing a won dispute alone cannot resolve a debt.
   * A positive remaining fee uses a separate v2 principal certificate and stays
   * uncollected; neither profile releases funding or payout holds. */
  extinguishPrincipal?(input: MarketplaceDisputePrincipalExtinctionInput,
    freshNativeProof: MarketplaceDisputeClosureProof): Promise<MarketplaceDisputePrincipalExtinctionResult>;
}
