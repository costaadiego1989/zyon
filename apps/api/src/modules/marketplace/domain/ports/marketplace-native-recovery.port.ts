import type { MarketplaceTransferRecoveryTarget } from "../services/marketplace-transfer-recovery-evidence.js";

/** GET-only reconciliation of a frozen original transfer; never a reversal instruction. */
export interface MarketplaceNativeRecoveryRequestV1 {
  version: 1;
  fundingPlanId: string;
  hostMerchantId: string;
  instructionsHash: string;
  budgetHash: string;
  chargebackAt: string;
  environment: "test" | "live";
  sourceId: string;
  paymentAmountCents: number;
  target: MarketplaceTransferRecoveryTarget & { kind: "original" };
  knownReversals: Array<{ providerOperationId: string; amountCents: number; reference: string; requestHash: string }>;
  requestHash: string;
}
export interface MarketplaceNativeRecoveryRefund {
  refundPlanId: string;
  returnId: string;
  allocationHash: string;
  requestHash: string;
  reference: string;
  providerOperationId: string;
  amountCents: number;
}
export interface MarketplaceNativeRecoveryGeneration {
  residualPlanId: string;
  generation: number;
  basisHash: string;
  allocationHash: string;
}
/** Historical refunds prove the source balance; none is a dispute credit. */
export interface MarketplaceNativeRecoveryRequestV2 extends Omit<MarketplaceNativeRecoveryRequestV1, "version" | "target"> {
  version: 2;
  target: MarketplaceTransferRecoveryTarget & { kind: "residual"; requestHash: string };
  residualPlan: { id: string; generation: number; basisHash: string; allocationHash: string };
  refunds: MarketplaceNativeRecoveryRefund[];
  generations: MarketplaceNativeRecoveryGeneration[];
  historyHash: string;
}
export type MarketplaceNativeRecoveryRequest = MarketplaceNativeRecoveryRequestV1 | MarketplaceNativeRecoveryRequestV2;
export interface MarketplaceNativeReversalReceipt {
  providerOperationId: string;
  providerTransferId: string;
  amountCents: number;
  currency: "BRL";
  sourceRefund: null;
  balanceTransactionId: string;
  balanceSourceId: string;
  balanceType: "transfer_refund";
  balanceStatus: "available";
  balanceAmountCents: number;
  balanceNetCents: number;
  balanceFeeCents: 0;
}
export interface MarketplaceNativeRecoveryProof {
  request: MarketplaceNativeRecoveryRequest;
  observedAt: string;
  refundedAmountCents: number;
  buyerRefundIds: string[];
  providerReversedAmountCents: number;
  receipts: MarketplaceNativeReversalReceipt[];
}
export interface MarketplaceNativeRecoveryProvider {
  reconcile(input: MarketplaceNativeRecoveryRequest): Promise<MarketplaceNativeRecoveryProof | undefined>;
}
export interface MarketplaceNativeRecoveryRepository {
  prepare(hostMerchantId: string, payoutId: string): Promise<MarketplaceNativeRecoveryRequest | undefined>;
  prepareResidual(hostMerchantId: string, residualOperationId: string): Promise<MarketplaceNativeRecoveryRequestV2 | undefined>;
  record(request: MarketplaceNativeRecoveryRequest, proof: MarketplaceNativeRecoveryProof): Promise<"partial" | "confirmed" | "blocked">;
}
