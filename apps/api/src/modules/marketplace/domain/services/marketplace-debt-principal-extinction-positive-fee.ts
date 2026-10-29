import type {MarketplaceDisputeFeeLiability} from "../ports/marketplace-dispute-closure.port.js";
import {allocateMarketplaceDisputeFee,marketplaceDisputeClosureProofHash} from "./marketplace-dispute-closure-evidence.js";
import {assertMarketplaceDebtPrincipalExtinctionBindings,buildMarketplaceDebtPrincipalExtinction,
  type MarketplaceDebtPrincipalExtinctionBasis,type MarketplaceDebtPrincipalExtinctionEvidence} from "./marketplace-debt-principal-extinction.js";

export interface MarketplaceDebtPrincipalExtinctionPositiveFeeEvidence extends Omit<MarketplaceDebtPrincipalExtinctionEvidence,"version"|"disputeFeeCents"> {
  version: 2;
  /** Total remaining native dispute cost, separate from the original capture fee. */
  disputeFeeCents: number;
  sellerDisputeFeeCents: number;
  feeAllocation: MarketplaceDisputeFeeLiability[];
  feeCollectionState: "uncollected";
}
export type MarketplaceDebtPrincipalExtinctionCertificateEvidence = MarketplaceDebtPrincipalExtinctionEvidence | MarketplaceDebtPrincipalExtinctionPositiveFeeEvidence;

/** Native restitution extinguishes the matching original principal only.
 * The remaining dispute fee is an independent, uncollected seller liability.
 * This certificate grants no checkout, credit, recovery, refund or hold release. */
export function buildMarketplaceDebtPrincipalExtinctionPositiveFee(input:MarketplaceDebtPrincipalExtinctionBasis,now=new Date()):MarketplaceDebtPrincipalExtinctionPositiveFeeEvidence {
  assertMarketplaceDebtPrincipalExtinctionBindings(input,now);
  const {request,proof,debt,payout}=input;
  if(proof.providerFeeCents<=0||proof.balanceDeltaCents!==-proof.providerFeeCents||
    proof.entries.some(row=>row.balanceTransactionId===request.captureBalanceTransactionId))throw Error("marketplace_debt_positive_fee_extinction_unproven");
  const feeAllocation=allocateMarketplaceDisputeFee(request,proof.providerFeeCents),seller=feeAllocation.find(row=>row.sellerMerchantId===debt.sellerMerchantId);
  if(!seller)throw Error("marketplace_debt_positive_fee_extinction_unproven");
  return {version:2,reason:"stripe_dispute_principal_extinguished",debtId:debt.id,sellerMerchantId:debt.sellerMerchantId,
    settlementId:debt.settlementId,payoutId:payout.id,hostMerchantId:request.hostMerchantId,fundingPlanId:request.paymentIntentId,
    providerDisputeId:request.providerDisputeId,closureSnapshotId:input.closureSnapshotId,requestHash:request.requestHash,
    proofHash:marketplaceDisputeClosureProofHash(proof),provider:"stripe",environment:request.environment,
    accountFingerprint:request.accountFingerprint,providerPaymentId:request.providerPaymentId,sourceId:request.sourceId,
    instructionsHash:request.instructionsHash,budgetHash:request.budgetHash,chargebackAt:input.chargebackAt.toISOString(),
    providerTransferId:payout.providerTransferId!,amountCents:debt.amountCents,
    withdrawal:{...proof.entries.find(row=>row.kind==="principal_withdrawal")!},
    reinstatement:{...proof.entries.find(row=>row.kind==="principal_reinstatement")!},
    disputeFeeCents:proof.providerFeeCents,sellerDisputeFeeCents:seller.feeCents,feeAllocation,feeCollectionState:"uncollected",
    fundingHoldReleased:false,payoutReauthorized:false};
}

/** Persisted version dispatch is explicit: a forged v1 cannot silently migrate
 * to the positive-fee profile, and an unsupported version cannot be certified. */
export function rebuildMarketplaceDebtPrincipalExtinction(input:MarketplaceDebtPrincipalExtinctionBasis,version:unknown,now=new Date()):MarketplaceDebtPrincipalExtinctionCertificateEvidence {
  if(version===1)return buildMarketplaceDebtPrincipalExtinction(input,now);
  if(version===2)return buildMarketplaceDebtPrincipalExtinctionPositiveFee(input,now);
  throw Error("marketplace_debt_principal_extinction_version_unproven");
}

export function marketplaceDebtPrincipalExtinctionFeeEvent(evidence:MarketplaceDebtPrincipalExtinctionCertificateEvidence) {
  return evidence.version===2?{certificate_version:2,fee_collection_state:evidence.feeCollectionState,
    seller_dispute_fee_cents:evidence.sellerDisputeFeeCents,fee_allocation:evidence.feeAllocation.map(row=>({...row}))}:{};
}
