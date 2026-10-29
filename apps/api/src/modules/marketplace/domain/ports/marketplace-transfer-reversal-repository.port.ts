import type { MarketplaceRefundObservation, MarketplaceRefundRequest } from "./marketplace-refund-provider.port.js";

export interface MarketplaceTransferReversalOperation {
  operationId: string;
  refundPlanId: string;
  payoutId: string;
  residualOperationId?: string;
  hostMerchantId: string;
  version: number;
  state: "planned" | "unknown" | "pending" | "confirmed" | "failed";
  request: MarketplaceRefundRequest;
  providerOperationId?: string;
}
export interface MarketplaceTransferReversalRepository {
  claim(hostMerchantId: string, operationId: string, now: Date, options?: { reconcileOnly?: boolean }): Promise<{
    operation: MarketplaceTransferReversalOperation; submit: boolean;
  } | undefined>;
  record(operation: MarketplaceTransferReversalOperation, observation: MarketplaceRefundObservation): Promise<boolean>;
  releaseUnsubmittedClaim(operation: MarketplaceTransferReversalOperation): Promise<boolean>;
  listUnresolved(limit: number): Promise<Array<{ hostMerchantId: string; operationId: string }>>;
}
export const MARKETPLACE_TRANSFER_REVERSAL_REPOSITORY = Symbol("MARKETPLACE_TRANSFER_REVERSAL_REPOSITORY");
