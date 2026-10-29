import type { AsaasMarketplaceResidualAccount,AsaasMarketplaceResidualTransferProof } from './asaas-marketplace-residual.port.js';
import type { AsaasMarketplaceResidualBasis,AsaasMarketplaceResidualAllocation } from '../services/asaas-marketplace-residual.js';
import type { buildMarketplaceFundingBudget } from '../services/marketplace-funding-budget.js';

export interface AsaasMarketplaceHostRetentionBasis extends Omit<AsaasMarketplaceResidualBasis,'version'> {version:7}
export interface AsaasMarketplaceHostRetentionAllocation extends Omit<AsaasMarketplaceResidualAllocation,'version'> {
  version:7;
  /** Beneficiary principal retained in the collector. Never a platform fee. */
  hostRetainedCents:number;
  outboundPayoutCents:number;
}
export interface AsaasMarketplaceHostRetentionRequest {
  version:7;kind:'host_principal_retention';provider:'asaas';currency:'BRL';paymentMethod:'pix'|'card';
  fundingPlanId:string;instructionsHash:string;budgetHash:string;basisHash:string;allocationHash:string;
  capture:ReturnType<typeof buildMarketplaceFundingBudget>['capture'];
  host:AsaasMarketplaceResidualAccount;
  basis:AsaasMarketplaceHostRetentionBasis;allocation:AsaasMarketplaceHostRetentionAllocation;
  amountCents:number;requestHash:string;
}
export interface AsaasMarketplaceHostRetentionLedgerReceipt {
  id:string;paymentId:string;type:'PAYMENT_RECEIVED'|'PAYMENT_FEE'|'PAYMENT_REVERSAL';amountCents:number;date:string;
}
export interface AsaasMarketplaceHostRetentionProof {
  version:7;kind:'host_principal_retention';association:'local_immutable_host_retention_journal';
  requestHash:string;providerPaymentId:string;hostAccountFingerprint:string;hostWalletId:string;
  amountCents:number;capturedGrossCents:number;processingFeeCents:number;refundedCents:number;
  paymentCreatedDate:string;observedAt:string;
  captureCredit:AsaasMarketplaceHostRetentionLedgerReceipt;
  processingFees:AsaasMarketplaceHostRetentionLedgerReceipt[];
  buyerRefundDebits:AsaasMarketplaceHostRetentionLedgerReceipt[];
}
export interface AsaasMarketplaceHostRetentionCertificate {
  journalId:string;request:AsaasMarketplaceHostRetentionRequest;proof:AsaasMarketplaceHostRetentionProof;certificateHash:string;
}
/** Only native read-only evidence can certify. This performs no PSP mutation. */
export interface AsaasMarketplaceHostRetentionVerifier {
  certify(request:AsaasMarketplaceHostRetentionRequest):Promise<{state:'certified';proof:AsaasMarketplaceHostRetentionProof}|{state:'unproven'}>;
}
export interface AsaasMarketplaceHostRetentionReader {
  read(pointer:{journalId:string;requestHash:string}):Promise<AsaasMarketplaceHostRetentionCertificate|undefined>;
}
export interface AsaasMarketplaceHostRetentionJournal extends AsaasMarketplaceHostRetentionReader {
  /** Uses the existing prepared plan and its order lock; no native POST. */
  certify(residualPlanId:string):Promise<{state:'certified'|'unproven'|'held';journalId:string;outboundOperations:number}>;
}
export interface AsaasMarketplaceHostRetentionOutboundRequest {
  version:7;provider:'asaas';fundingPlanId:string;beneficiaryMerchantId:string;basisHash:string;allocationHash:string;
  capture:AsaasMarketplaceHostRetentionRequest['capture'];accountFingerprint:string;providerPaymentId:string;
  destination:string;amountCents:number;currency:'BRL';reference:string;requestHash:string;
  asaasFunding:AsaasMarketplaceHostRetentionBasis['asaasFunding'];residualAllocation:AsaasMarketplaceHostRetentionAllocation;
  remainingTotalCents:number;refunds:Array<{providerOperationId:string;amountCents:number}>;
  transfers:Array<{reference:string;destination:string;amountCents:number}>;
  hostRetention:{journalId:string;requestHash:string};
}
/** The native transfer has the same two-account receipt shape as V5. */
export type AsaasMarketplaceHostRetentionOutboundProof=AsaasMarketplaceResidualTransferProof;
