import { createHash } from "node:crypto";
import type { MarketplaceNativeRecoveryProof, MarketplaceNativeRecoveryRequest, MarketplaceNativeRecoveryRequestV2, MarketplaceNativeReversalReceipt } from "../ports/marketplace-native-recovery.port.js";
import type { MarketplaceTransferRecoveryTarget } from "./marketplace-transfer-recovery-evidence.js";

const canonical = (value: unknown): string => JSON.stringify(value, (_, entry) => entry && typeof entry === "object" && !Array.isArray(entry)
  ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
export const nativeRecoveryHash = (value: unknown): string => createHash("sha256").update(canonical(value)).digest("hex");
const cents = (value: number): boolean => Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647;

export function validNativeRecoveryRequest(request: MarketplaceNativeRecoveryRequest): boolean {
  const { requestHash, ...raw } = request;
  const target = request.target;
  return (request.version === 1 || request.version === 2) && Boolean(request.fundingPlanId && request.hostMerchantId) &&
    /^[a-f0-9]{64}$/.test(request.instructionsHash) && /^[a-f0-9]{64}$/.test(request.budgetHash) &&
    Number.isFinite(Date.parse(request.chargebackAt)) && ["test", "live"].includes(request.environment) &&
    /^ch_[A-Za-z0-9_]+$/.test(request.sourceId) && cents(request.paymentAmountCents) &&
    target.provider === "stripe" && Boolean(target.id && target.beneficiaryMerchantId && target.accountFingerprint && target.reference) &&
    /^pi_[A-Za-z0-9_]+$/.test(target.providerPaymentId) && /^tr_[A-Za-z0-9_]+$/.test(target.providerTransferId) &&
    /^acct_[A-Za-z0-9_]+$/.test(target.destination) && cents(target.amountCents) && target.amountCents <= request.paymentAmountCents &&
    (request.version === 1 ? target.kind === "original" && target.requestHash === undefined : validResidualHistory(request)) &&
    Array.isArray(request.knownReversals) && request.knownReversals.length <= 2000 &&
    new Set(request.knownReversals.map(row => row.providerOperationId)).size === request.knownReversals.length &&
    request.knownReversals.every(row => /^trr_[A-Za-z0-9_]+$/.test(row.providerOperationId) && cents(row.amountCents) &&
      Boolean(row.reference) && /^[a-f0-9]{64}$/.test(row.requestHash)) &&
    request.knownReversals.reduce((sum, row) => sum + row.amountCents, 0) <= target.amountCents && nativeRecoveryHash(raw) === requestHash;
}

function validResidualHistory(request: MarketplaceNativeRecoveryRequestV2): boolean {
  const { residualPlan: plan, refunds, generations } = request;
  return request.target.kind === "residual" && /^[a-f0-9]{64}$/.test(request.target.requestHash) &&
    /^mresidual_[a-f0-9]{64}$/.test(request.target.reference) && !!plan?.id && Number.isSafeInteger(plan.generation) && plan.generation > 0 &&
    /^[a-f0-9]{64}$/.test(plan.basisHash) && /^[a-f0-9]{64}$/.test(plan.allocationHash) &&
    Array.isArray(refunds) && refunds.length > 0 && refunds.length <= 2000 &&
    new Set(refunds.map(row => row.refundPlanId)).size === refunds.length &&
    new Set(refunds.map(row => row.returnId)).size === refunds.length &&
    new Set(refunds.map(row => row.providerOperationId)).size === refunds.length &&
    refunds.every(row => !!row.refundPlanId && !!row.returnId && /^[a-f0-9]{64}$/.test(row.allocationHash) &&
      /^[a-f0-9]{64}$/.test(row.requestHash) && /^mrefund_[a-f0-9]{64}$/.test(row.reference) && /^re_[A-Za-z0-9_]+$/.test(row.providerOperationId) && cents(row.amountCents)) &&
    refunds.reduce((sum, row) => sum + row.amountCents, 0) <= request.paymentAmountCents &&
    Array.isArray(generations) && generations.length > 0 && generations.length <= 2000 &&
    new Set(generations.map(row => row.residualPlanId)).size === generations.length &&
    generations.every((row, index) => !!row.residualPlanId && row.generation === index + 1 &&
      /^[a-f0-9]{64}$/.test(row.basisHash) && /^[a-f0-9]{64}$/.test(row.allocationHash)) &&
    generations.some(row => row.residualPlanId === plan.id && row.generation === plan.generation && row.basisHash === plan.basisHash && row.allocationHash === plan.allocationHash) &&
    nativeRecoveryHash({ refunds, generations }) === request.historyHash;
}

export function validNativeRecoveryProof(request: MarketplaceNativeRecoveryRequest, proof: MarketplaceNativeRecoveryProof): boolean {
  return validNativeRecoveryRequest(request) && nativeRecoveryHash(request) === nativeRecoveryHash(proof.request) &&
    Number.isFinite(Date.parse(proof.observedAt)) && Array.isArray(proof.buyerRefundIds) &&
    (request.version === 1 ? proof.refundedAmountCents === 0 && !proof.buyerRefundIds.length :
      proof.refundedAmountCents === request.refunds.reduce((sum, row) => sum + row.amountCents, 0) &&
      nativeRecoveryHash(proof.buyerRefundIds) === nativeRecoveryHash(request.refunds.map(row => row.providerOperationId))) &&
    Array.isArray(proof.receipts) && proof.receipts.length > 0 && proof.receipts.length <= 2000 &&
    new Set(proof.receipts.map(row => row.providerOperationId)).size === proof.receipts.length &&
    new Set(proof.receipts.map(row => row.balanceTransactionId)).size === proof.receipts.length &&
    proof.receipts.every(row => /^trr_[A-Za-z0-9_]+$/.test(row.providerOperationId) && row.providerTransferId === request.target.providerTransferId &&
      cents(row.amountCents) && row.currency === "BRL" && row.sourceRefund === null && /^txn_[A-Za-z0-9_]+$/.test(row.balanceTransactionId) &&
      row.balanceSourceId === row.providerOperationId && row.balanceType === "transfer_refund" && row.balanceStatus === "available" &&
      row.balanceAmountCents === row.amountCents && row.balanceNetCents === row.amountCents && row.balanceFeeCents === 0) &&
    proof.receipts.reduce((sum, row) => sum + row.amountCents, 0) === proof.providerReversedAmountCents &&
    proof.providerReversedAmountCents <= request.target.amountCents &&
    request.knownReversals.every(known => proof.receipts.some(row => row.providerOperationId === known.providerOperationId && row.amountCents === known.amountCents));
}

export interface MarketplaceNativeRecoveryCreditEvidence {
  version: 2 | 3;
  reason: "chargeback_transfer_principal_credit";
  fundingPlanId: string; hostMerchantId: string; instructionsHash: string; budgetHash: string; chargebackAt: string;
  target: MarketplaceTransferRecoveryTarget;
  receipt: MarketplaceNativeReversalReceipt;
  proof: MarketplaceNativeRecoveryProof;
}
export function buildMarketplaceNativeRecoveryCreditEvidence(proof: MarketplaceNativeRecoveryProof, providerOperationId: string): MarketplaceNativeRecoveryCreditEvidence | undefined {
  if (!validNativeRecoveryProof(proof.request, proof)) return undefined;
  const receipt = proof.receipts.find(row => row.providerOperationId === providerOperationId);
  if (!receipt || proof.request.knownReversals.some(row => row.providerOperationId === providerOperationId)) return undefined;
  const request = proof.request;
  return { version: request.version === 1 ? 2 : 3, reason: "chargeback_transfer_principal_credit", fundingPlanId: request.fundingPlanId,
    hostMerchantId: request.hostMerchantId, instructionsHash: request.instructionsHash, budgetHash: request.budgetHash,
    chargebackAt: request.chargebackAt, target: request.target, receipt, proof };
}

export interface MarketplaceCumulativeRecoveryEvidence {
  version: 2 | 3; reason: "chargeback_transfer_principal_recovered";
  fundingPlanId: string; hostMerchantId: string; instructionsHash: string; budgetHash: string; chargebackAt: string;
  target: MarketplaceTransferRecoveryTarget;
  request?: MarketplaceNativeRecoveryRequestV2;
  credits: Array<{ creditId: string; evidenceHash: string; providerOperationId: string; amountCents: number }>;
}
export function buildMarketplaceCumulativeRecoveryEvidence(request: MarketplaceNativeRecoveryRequest,
  credits: MarketplaceCumulativeRecoveryEvidence["credits"]): MarketplaceCumulativeRecoveryEvidence | undefined {
  if (!validNativeRecoveryRequest(request) || !credits.length || credits.length > 2000 ||
    new Set(credits.map(row => row.creditId)).size !== credits.length || new Set(credits.map(row => row.providerOperationId)).size !== credits.length ||
    credits.some(row => !row.creditId || !/^[a-f0-9]{64}$/.test(row.evidenceHash) || !/^trr_[A-Za-z0-9_]+$/.test(row.providerOperationId) || !cents(row.amountCents)) ||
    credits.reduce((sum, row) => sum + row.amountCents, 0) !== request.target.amountCents) return undefined;
  return { version: request.version === 1 ? 2 : 3, reason: "chargeback_transfer_principal_recovered", fundingPlanId: request.fundingPlanId,
    hostMerchantId: request.hostMerchantId, instructionsHash: request.instructionsHash, budgetHash: request.budgetHash,
    chargebackAt: request.chargebackAt, target: request.target, ...(request.version === 2 ? { request } : {}),
    credits: [...credits].sort((a, b) => a.creditId < b.creditId ? -1 : a.creditId > b.creditId ? 1 : 0) };
}
