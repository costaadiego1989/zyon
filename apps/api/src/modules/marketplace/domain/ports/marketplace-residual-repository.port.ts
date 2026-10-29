import type { MarketplaceResidualObservation, MarketplaceResidualRequest } from "./marketplace-residual-provider.port.js";

export interface MarketplaceResidualOperation {
  operationId: string;
  residualPlanId: string;
  hostMerchantId: string;
  version: number;
  state: "planned" | "unknown" | "pending" | "confirmed" | "failed" | "cancelled";
  request: MarketplaceResidualRequest;
  providerTransferId?: string;
}
export interface MarketplaceResidualRepository {
  claim(hostMerchantId: string, operationId: string, now: Date, options?: { reconcileOnly?: boolean }):
    Promise<{ operation: MarketplaceResidualOperation; submit: boolean } | undefined>;
  record(operation: MarketplaceResidualOperation, observation: MarketplaceResidualObservation): Promise<boolean>;
  releaseUnsubmittedClaim(operation: MarketplaceResidualOperation): Promise<boolean>;
  listUnresolved(limit: number): Promise<Array<{ hostMerchantId: string; operationId: string }>>;
  listDue(now: Date, limit: number): Promise<Array<{ hostMerchantId: string; operationId: string }>>;
  /** Rotates deferred planned rows without ever reopening an uncertain submission. */
  deferPlanned(hostMerchantId: string, operationId: string): Promise<void>;
}
export const MARKETPLACE_RESIDUAL_REPOSITORY = Symbol("MARKETPLACE_RESIDUAL_REPOSITORY");
