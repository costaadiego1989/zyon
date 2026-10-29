import type { MarketplaceResidualObservation, MarketplaceResidualRequest } from "./marketplace-residual-provider.port.js";
import type { AsaasMarketplaceWalletReturnObservation, AsaasMarketplaceWalletReturnRequest,AsaasMarketplaceWalletReturnLedgerReceipt } from "./asaas-marketplace-transfer-recovery.port.js";
import type { AsaasMarketplaceResidualAllocation, AsaasMarketplaceResidualFunding } from "../services/asaas-marketplace-residual.js";

/** V5 spends the first post-refund remainder of the original capture only.
 * It is neither another wallet return nor a source-contribution budget. */
export interface AsaasMarketplaceResidualRequest extends Omit<MarketplaceResidualRequest, "provider" | "version"> {
  version: 5;
  provider: "asaas";
  fundingPlanId: string;
  beneficiaryMerchantId: string;
  basisHash: string;
  allocationHash: string;
  asaasFunding: AsaasMarketplaceResidualFunding;
  residualAllocation: AsaasMarketplaceResidualAllocation;
}
export interface AsaasMarketplaceResidualAuthorization {
  operationId: string;
  requestHash: string;
  state: "claimed" | "submitted";
  providerTransferId?: string;
}
export interface AsaasMarketplaceResidualSubmissionPermit {
  operationId: string;
  requestHash: string;
  state: "submission_authorized";
}
/** A claimed journal is necessary but insufficient. This one-use permission
 * must commit durably AFTER native preflight and BEFORE attempting the POST. */
export interface AsaasMarketplaceResidualAuthorizationReader {
  read(requestHash: string): Promise<AsaasMarketplaceResidualAuthorization | undefined>;
  consumeSubmissionAuthorization(requestHash: string,preflight?:{hostRetentionProof:import('./asaas-marketplace-host-retention.port.js').AsaasMarketplaceHostRetentionProof}): Promise<AsaasMarketplaceResidualSubmissionPermit | undefined>;
}
export interface AsaasMarketplaceResidualAccount {
  merchantId: string;
  environment: "test" | "live";
  accountFingerprint: string;
  walletId: string;
  asaasOrigin: string;
  /** Canonical hash of the real (merchantId, provider) connection primary key. */
  connectionId: string;
  secretCipherHash: string;
}
export interface AsaasMarketplaceResidualAccountReader {
  /** Resolve the connected credential of THIS frozen merchant/account/wallet.
   * A missing or rotated identity cannot fall back to another connected PSP. */
  read(account: AsaasMarketplaceResidualAccount): Promise<{ asaasKey?: string; asaasOrigin?: string } | undefined>;
}
export interface AsaasMarketplaceResidualWalletReturnVerifier {
  reconcile(request: AsaasMarketplaceWalletReturnRequest, providerTransferId: string): Promise<AsaasMarketplaceWalletReturnObservation>;
}
export interface AsaasMarketplaceResidualProvider {
  submit(input: AsaasMarketplaceResidualRequest | import('./asaas-marketplace-host-retention.port.js').AsaasMarketplaceHostRetentionOutboundRequest): Promise<MarketplaceResidualObservation | { state: "not_submitted" }>;
  reconcile(input: AsaasMarketplaceResidualRequest | import('./asaas-marketplace-host-retention.port.js').AsaasMarketplaceHostRetentionOutboundRequest, providerTransferId?: string): Promise<MarketplaceResidualObservation>;
}
export interface AsaasMarketplaceResidualTransferProof {
  version: 5;
  kind: "residual_payout";
  association: "local_immutable_residual_journal";
  requestHash: string;
  reference: string;
  providerTransferId: string;
  hostAccountFingerprint: string;
  sellerAccountFingerprint: string;
  hostWalletId: string;
  sellerWalletId: string;
  amountCents: number;
  observedAt: string;
  hostDebit: AsaasMarketplaceWalletReturnLedgerReceipt;
  sellerCredit: AsaasMarketplaceWalletReturnLedgerReceipt;
}
