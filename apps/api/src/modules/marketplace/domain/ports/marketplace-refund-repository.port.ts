import type { MarketplaceRefundObservation, MarketplaceRefundRequest } from "./marketplace-refund-provider.port.js";

export interface MarketplaceRefundOperation {
  operationId: string;
  refundPlanId: string;
  hostMerchantId: string;
  version: number;
  state: "planned" | "unknown" | "pending" | "confirmed" | "failed";
  request: MarketplaceRefundRequest;
  providerOperationId?: string;
}
export interface MarketplaceRefundRepository {
  claim(hostMerchantId: string, refundPlanId: string, now: Date, options?: { reconcileOnly?: boolean }): Promise<{ operation: MarketplaceRefundOperation; submit: boolean } | undefined>;
  record(operation: MarketplaceRefundOperation, observation: MarketplaceRefundObservation): Promise<boolean>;
  releaseUnsubmittedClaim(operation: MarketplaceRefundOperation): Promise<boolean>;
  listUnresolved(limit: number): Promise<Array<{ hostMerchantId: string; refundPlanId: string }>>;
}
export const MARKETPLACE_REFUND_REPOSITORY = Symbol("MARKETPLACE_REFUND_REPOSITORY");
