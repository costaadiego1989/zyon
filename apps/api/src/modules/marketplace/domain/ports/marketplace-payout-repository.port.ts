import type { MarketplacePayoutObservation, MarketplacePayoutRequest } from "./marketplace-payout-provider.port.js";

export interface MarketplacePayoutOperation {
  payoutId: string;
  settlementId?: string;
  request: MarketplacePayoutRequest;
  state: "planned" | "unknown" | "pending" | "confirmed" | "failed" | "cancelled";
  version: number;
  providerTransferId?: string;
}

export interface MarketplacePayoutRepository {
  /** Commits unknown before the first network request; only one caller may submit. */
  claim(settlementId: string, now: Date): Promise<{ operation: MarketplacePayoutOperation; submit: boolean } | undefined>;
  record(operation: MarketplacePayoutOperation, observation: MarketplacePayoutObservation): Promise<boolean>;
  /** Only the submission owner may release a claim proven to have made no POST. */
  releaseUnsubmittedClaim(operation: MarketplacePayoutOperation): Promise<boolean>;
  listUnresolved(limit: number): Promise<string[]>;
  listDueHost?(now: Date, limit: number): Promise<string[]>;
}

export const MARKETPLACE_PAYOUT_REPOSITORY = Symbol("MARKETPLACE_PAYOUT_REPOSITORY");
