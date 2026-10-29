import type { MarketplaceSellerFeeCredit } from "./marketplace-seller-fee-collection.port.js";
import type { MarketplaceHostFeeCredit } from "./marketplace-host-fee-collection.port.js";

/** The original incoming credit stays immutable. Only its exact excess may return. */
export interface MarketplaceFeeExcessRequest {
  family: "seller" | "host";
  credit: MarketplaceSellerFeeCredit | MarketplaceHostFeeCredit;
  amountCents: number; actorUserId: string; authorisedAt: string;
  reference: string; requestHash: string;
}
export interface MarketplaceFeeExcessOperation {
  request: MarketplaceFeeExcessRequest; submit: boolean; providerRefundId?: string;
}
export interface MarketplaceFeeExcessProof {
  requestHash: string; accountFingerprint: string; observedAt: string;
  refund: {
    object: string; id: string; charge: string; payment_intent: string; amount: number;
    currency: string; status: string; created: number; balance_transaction: string;
    metadata: Record<string, string>;
  };
  balance: {
    object: string; id: string; source: string; type: string; status: string; currency: string;
    amount: number; fee: number; net: number; exchange_rate: number | null; available_on: number;
  };
}
export interface MarketplaceFeeExcessObservation {
  state: "confirmed" | "pending" | "unknown" | "failed";
  providerRefundId?: string; proof?: MarketplaceFeeExcessProof;
}
export interface MarketplaceFeeExcessReturn {
  request: MarketplaceFeeExcessRequest; proof: MarketplaceFeeExcessProof; certificateHash: string;
}
export type MarketplaceFeeExcessStatus = "held" | "unknown" | "pending" | "returned" | "failed";
export interface MarketplaceFeeExcessJournal {
  returnedExcessCents?: number; outstandingExcessCents?: number;
  excessStatus?: MarketplaceFeeExcessStatus;
  canReturnExcess?: boolean; excessReturn?: MarketplaceFeeExcessReturn;
}
