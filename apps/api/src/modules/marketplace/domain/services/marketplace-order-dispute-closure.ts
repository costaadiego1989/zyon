import type { MarketplaceDisputeClosureProof, MarketplaceDisputeClosureRequest } from "../ports/marketplace-dispute-closure.port.js";
import type { MarketplaceHostPrincipalExtinctionEvidence, MarketplaceOrderDisputeClosureEvidence, MarketplaceOrderDisputePayoutReference, MarketplaceOrderDisputeSellerReference } from "../ports/marketplace-order-dispute-closure.port.js";
import type { MarketplaceSellerDisputeObligationEvidence } from "./marketplace-seller-dispute-obligation.js";
import { marketplaceSellerDisputeObligationId } from "./marketplace-seller-dispute-obligation.js";
import { allocateMarketplaceDisputeFee, assertMarketplaceDisputeClosureProof, marketplaceDisputeClosureProofHash } from "./marketplace-dispute-closure-evidence.js";
import { buildMarketplaceFundingBudget, type FrozenMarketplaceFunding } from "./marketplace-funding-budget.js";
import { fundingHash } from "../../infrastructure/repositories/prisma-marketplace-funding.repository.js";
import type { MarketplaceHostDisputeObligationEvidence } from "../ports/marketplace-host-fee-collection.port.js";
import { marketplaceHostDisputeObligationId } from "./marketplace-host-fee-collection.js";

type Budget = ReturnType<typeof buildMarketplaceFundingBudget>;
export interface MarketplaceOrderDisputeClosureBasis {
  request: MarketplaceDisputeClosureRequest; proof: MarketplaceDisputeClosureProof; closureSnapshotId: string;
  instructions: FrozenMarketplaceFunding; budget: Budget; chargebackAt: Date; originalFundingStatus: "held";
  /** Repository proves the absence of other financial histories and each native receipt in SQL. */
  unsupportedHistory: false;
  payouts: Array<MarketplaceOrderDisputePayoutReference & { status: string; fundingPlanId: string; provider: string;
    environment: "test" | "live"; accountFingerprint: string; providerPaymentId: string; currency: string;
    claimedAt: Date | null; reconciledAt: Date | null }>;
  hostDebt: null | { payoutId: string; hostMerchantId: string; amountCents: number; status: string; recoveryId: string | null; resolvedAt: Date | null };
  hostPrincipal: null | { id: string; evidenceHash: string; evidence: MarketplaceHostPrincipalExtinctionEvidence };
  hostObligation?: null | { id: string; evidenceHash: string; evidence: MarketplaceHostDisputeObligationEvidence };
  /** Only persisted obligations for which marketplace_seller_dispute_obligation_valid is true. */
  sellerObligations: Array<{ id: string; evidenceHash: string; payoutId: string; evidence: MarketplaceSellerDisputeObligationEvidence }>;
  replay?: boolean;
}
function fail(): never { throw Error("marketplace_order_dispute_closure_unproven"); }
const cents = (v: number, positive = false) => Number.isSafeInteger(v) && v >= (positive ? 1 : 0) && v <= 2147483647;
const date = (v: Date | null): v is Date => v instanceof Date && Number.isFinite(v.getTime());
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

function basis(input: MarketplaceOrderDisputeClosureBasis, now: Date) {
  const { request: r, proof: p, instructions: i, budget: b } = input;
  assertMarketplaceDisputeClosureProof(r, p, now);
  if (p.status !== "won" || p.principalReinstatedCents !== r.amountCents ||
      p.entries.some(e => e.balanceTransactionId === r.captureBalanceTransactionId) ||
      input.originalFundingStatus !== "held" || input.unsupportedHistory !== false || !date(input.chargebackAt) ||
      fundingHash(i) !== r.instructionsHash || fundingHash(b) !== r.budgetHash ||
      fundingHash(buildMarketplaceFundingBudget(i, b.capture)) !== fundingHash(b) ||
      i.hostMerchantId !== r.hostMerchantId || i.provider !== r.provider || i.environment !== r.environment ||
      i.accountFingerprint !== r.accountFingerprint || b.capture.providerPaymentId !== r.providerPaymentId ||
      b.capture.sourceId !== r.sourceId || b.capture.balanceTransactionId !== r.captureBalanceTransactionId ||
      fundingHash([...i.lines].map(l => ({lineItemId:l.lineItemId,sellerMerchantId:l.sellerMerchantId,grossAmountCents:l.grossAmountCents,commissionCents:l.commissionCents})).sort((a,b)=>compare(a.lineItemId,b.lineItemId))) !== fundingHash(r.sales) ||
      input.closureSnapshotId !== `mdispute_snapshot_${fundingHash([r.hostMerchantId,r.paymentIntentId,r.providerDisputeId,marketplaceDisputeClosureProofHash(p)])}`) fail();
  const positives = b.beneficiaries.filter(v => v.amountCents > 0);
  if (input.payouts.length !== positives.length || new Set(input.payouts.map(v=>v.payoutId)).size !== positives.length ||
      new Set(input.payouts.map(v=>v.beneficiaryMerchantId)).size !== positives.length ||
      new Set(input.payouts.map(v=>v.providerTransferId)).size !== positives.length) fail();
  for (const payout of input.payouts) {
    const beneficiary = positives.find(v=>v.merchantId===payout.beneficiaryMerchantId);
    if (!beneficiary || payout.destination !== beneficiary.destination || payout.amountCents !== beneficiary.amountCents ||
        !cents(payout.amountCents,true) || payout.status !== "confirmed" || !date(payout.claimedAt) || !date(payout.reconciledAt) ||
        payout.kind !== (payout.beneficiaryMerchantId===r.hostMerchantId ? "host_receivable" : "seller_settlement") ||
        payout.fundingPlanId !== r.paymentIntentId || payout.provider !== "stripe" || payout.environment !== r.environment ||
        payout.accountFingerprint !== r.accountFingerprint || payout.providerPaymentId !== r.providerPaymentId || payout.currency !== "BRL" ||
        !/^acct_[A-Za-z0-9_]+$/.test(payout.destination) || !/^tr_[A-Za-z0-9_]+$/.test(payout.providerTransferId)) fail();
  }
  const host = b.beneficiaries.find(v=>v.merchantId===r.hostMerchantId);
  if (!host) fail();
  const fees = allocateMarketplaceDisputeFee(r,p.providerFeeCents);
  return {host,fees,hostFee:fees.find(v=>v.sellerMerchantId===r.hostMerchantId)?.feeCents ?? 0};
}

export function buildMarketplaceHostPrincipalExtinction(input: MarketplaceOrderDisputeClosureBasis, now = new Date()): MarketplaceHostPrincipalExtinctionEvidence {
  const {hostFee,host} = basis(input,now), {request:r,proof:p,hostDebt:d} = input;
  const payout = input.payouts.find(v=>v.kind === "host_receivable");
  if (!d || !payout || host.amountCents <= 0 || d.payoutId !== payout.payoutId || d.hostMerchantId !== r.hostMerchantId ||
      d.amountCents !== host.amountCents || d.recoveryId !== null ||
      (input.replay ? d.status !== "extinguished" || !date(d.resolvedAt) : d.status !== "outstanding" || d.resolvedAt !== null)) fail();
  return {version:1,reason:"stripe_host_dispute_principal_extinguished",payoutId:payout.payoutId,hostMerchantId:r.hostMerchantId,
    fundingPlanId:r.paymentIntentId,providerDisputeId:r.providerDisputeId,closureSnapshotId:input.closureSnapshotId,requestHash:r.requestHash,
    proofHash:marketplaceDisputeClosureProofHash(p),instructionsHash:r.instructionsHash,budgetHash:r.budgetHash,provider:"stripe",environment:r.environment,
    accountFingerprint:r.accountFingerprint,providerPaymentId:r.providerPaymentId,sourceId:r.sourceId,chargebackAt:input.chargebackAt.toISOString(),
    providerTransferId:payout.providerTransferId,amountCents:d.amountCents,withdrawal:{...p.entries.find(v=>v.kind==="principal_withdrawal")!},
    reinstatement:{...p.entries.find(v=>v.kind==="principal_reinstatement")!},disputeFeeCents:p.providerFeeCents,hostDisputeFeeCents:hostFee,
    feeCollectionState:"uncollected",fundingHoldReleased:false,payoutReauthorized:false};
}

export function buildMarketplaceOrderDisputeClosure(input: MarketplaceOrderDisputeClosureBasis, now = new Date()): MarketplaceOrderDisputeClosureEvidence {
  const {host,fees,hostFee} = basis(input,now), {request:r,proof:p} = input;
  const zeroProfile = p.providerFeeCents===0 || fees.some(v=>v.sellerMerchantId!==r.hostMerchantId && v.feeCents===0) ||
    hostFee===0 && r.sales.some(v=>v.sellerMerchantId===r.hostMerchantId);
  if (!cents(p.providerFeeCents)) fail();
  let hostPrincipal: MarketplaceOrderDisputeClosureEvidence["hostPrincipal"] = null;
  if (host.amountCents > 0) {
    const existing = input.hostPrincipal, expected = buildMarketplaceHostPrincipalExtinction({...input,replay:true},now);
    if (!existing || existing.id !== marketplaceHostPrincipalExtinctionId(expected) || existing.evidenceHash !== fundingHash(expected) || fundingHash(existing.evidence) !== fundingHash(expected)) fail();
    hostPrincipal = {certificateId:existing.id,evidenceHash:existing.evidenceHash,payoutId:expected.payoutId,amountCents:expected.amountCents};
  } else if (input.hostDebt !== null || input.hostPrincipal !== null || input.payouts.some(v=>v.kind==="host_receivable")) fail();
  const external = fees.filter(v=>v.sellerMerchantId!==r.hostMerchantId);
  if (!external.length || external.some(v=>!cents(v.feeCents)) || input.sellerObligations.length !== external.length ||
      new Set(input.sellerObligations.map(v=>v.id)).size !== external.length || new Set(input.sellerObligations.map(v=>v.evidence.debtId)).size !== external.length) fail();
  const sellers: MarketplaceOrderDisputeSellerReference[] = [];
  for (const allocation of external) {
    const row = input.sellerObligations.find(v=>v.evidence.sellerMerchantId===allocation.sellerMerchantId), e = row?.evidence;
    const payout = input.payouts.find(v=>v.beneficiaryMerchantId===allocation.sellerMerchantId);
    if (!row || !e || !payout || row.payoutId !== payout.payoutId || row.id !== marketplaceSellerDisputeObligationId(e) || row.evidenceHash !== fundingHash(e) ||
        (allocation.feeCents===0 ? e.version!==2 || e.reason!=="stripe_seller_zero_fee_dispute_obligation_closed" :
          e.version!==1 || e.reason!=="stripe_seller_dispute_obligation_closed") || e.hostMerchantId !== r.hostMerchantId || e.fundingPlanId !== r.paymentIntentId ||
        e.providerDisputeId !== r.providerDisputeId || e.closureSnapshotId !== input.closureSnapshotId || e.provider !== "stripe" || e.environment !== r.environment ||
        e.accountFingerprint !== r.accountFingerprint || e.principalAmountCents !== payout.amountCents || e.disputeFeeCents !== allocation.feeCents ||
        e.collectedFeeCents !== allocation.feeCents || !cents(e.processingFeeCents) || e.excessLiabilityCents !== 0 || e.fundingHoldReleased !== false || e.payoutReauthorized !== false ||
        !/^mdebt_extinction_[a-f0-9]{64}$/.test(e.feeCertificateId) || !/^[a-f0-9]{64}$/.test(e.feeCertificateHash) ||
        !Array.isArray(e.creditHashes) || (allocation.feeCents===0 ? e.creditHashes.length!==0 || e.processingFeeCents!==0 : !e.creditHashes.length) || e.creditHashes.length>2000 || e.creditHashes.some(h=>!/^[a-f0-9]{64}$/.test(h)) || new Set(e.creditHashes).size!==e.creditHashes.length) fail();
    sellers.push({obligationId:row.id,debtId:e.debtId,payoutId:payout.payoutId,sellerMerchantId:e.sellerMerchantId,feeCertificateId:e.feeCertificateId,
      feeCertificateHash:e.feeCertificateHash,obligationEvidenceHash:row.evidenceHash,principalAmountCents:e.principalAmountCents,
      disputeFeeCents:e.disputeFeeCents,collectedFeeCents:e.collectedFeeCents,processingFeeCents:e.processingFeeCents,creditHashes:[...e.creditHashes]});
  }
  let hostObligation: import("../ports/marketplace-order-dispute-closure.port.js").MarketplaceOrderDisputeHostObligationReference | undefined;
  if (zeroProfile && hostFee===0 && input.hostObligation != null) fail();
  if (hostFee>0) {
    const row=input.hostObligation, e=row?.evidence;
    if (!row || !e || !hostPrincipal || row.id!==marketplaceHostDisputeObligationId(e) || row.evidenceHash!==fundingHash(e) ||
        e.version!==1 || e.reason!=="stripe_host_dispute_obligation_closed" || e.debtId!==hostPrincipal.payoutId || e.payoutId!==hostPrincipal.payoutId ||
        e.feeCertificateId!==hostPrincipal.certificateId || e.feeCertificateHash!==hostPrincipal.evidenceHash || e.hostMerchantId!==r.hostMerchantId || e.fundingPlanId!==r.paymentIntentId ||
        e.providerDisputeId!==r.providerDisputeId || e.closureSnapshotId!==input.closureSnapshotId || e.provider!=="stripe" || e.environment!==r.environment || e.accountFingerprint!==r.accountFingerprint ||
        e.principalAmountCents!==hostPrincipal.amountCents || e.disputeFeeCents!==hostFee || e.collectedFeeCents!==hostFee || !cents(e.processingFeeCents) || e.excessLiabilityCents!==0 ||
        e.fundingHoldReleased!==false || e.payoutReauthorized!==false || !Array.isArray(e.creditHashes) || !e.creditHashes.length || e.creditHashes.length>2000 ||
        e.creditHashes.some(h=>!/^[a-f0-9]{64}$/.test(h)) || new Set(e.creditHashes).size!==e.creditHashes.length) fail();
    hostObligation={obligationId:row.id,payoutId:e.payoutId,feeCertificateId:e.feeCertificateId,feeCertificateHash:e.feeCertificateHash,obligationEvidenceHash:row.evidenceHash,
      principalAmountCents:e.principalAmountCents,disputeFeeCents:e.disputeFeeCents,collectedFeeCents:e.collectedFeeCents,processingFeeCents:e.processingFeeCents,creditHashes:[...e.creditHashes]};
  }
  const collectedFeeCents = sellers.reduce((sum,v)=>sum+v.collectedFeeCents,0)+(hostObligation?.collectedFeeCents??0), processingFeeCents = sellers.reduce((sum,v)=>sum+v.processingFeeCents,0)+(hostObligation?.processingFeeCents??0);
  if (collectedFeeCents!==p.providerFeeCents || !cents(processingFeeCents)) fail();
  const result = {version:1 as const,reason:"stripe_order_dispute_closed" as const,hostMerchantId:r.hostMerchantId,fundingPlanId:r.paymentIntentId,providerDisputeId:r.providerDisputeId,
    closureSnapshotId:input.closureSnapshotId,requestHash:r.requestHash,proofHash:marketplaceDisputeClosureProofHash(p),instructionsHash:r.instructionsHash,budgetHash:r.budgetHash,
    provider:"stripe" as const,environment:r.environment,accountFingerprint:r.accountFingerprint,providerPaymentId:r.providerPaymentId,sourceId:r.sourceId,
    chargebackAt:input.chargebackAt.toISOString(),principalReinstatedCents:p.principalReinstatedCents,disputeFeeCents:p.providerFeeCents,hostDisputeFeeCents:0 as const,
    collectedFeeCents,processingFeeCents,excessLiabilityCents:0 as const,hostPrincipal,sellerObligations:sellers.sort((a,b)=>compare(a.sellerMerchantId,b.sellerMerchantId)),
    payouts:input.payouts.map(v=>({payoutId:v.payoutId,beneficiaryMerchantId:v.beneficiaryMerchantId,kind:v.kind,destination:v.destination,amountCents:v.amountCents,providerTransferId:v.providerTransferId})).sort((a,b)=>compare(a.payoutId,b.payoutId)),
    originalFundingStatus:"held" as const,operationalHoldClosed:true as const,fundingHoldReleased:false as const,payoutReauthorized:false as const};
  if (zeroProfile) return {...result,version:3,hostDisputeFeeCents:hostFee,...(hostObligation ? {hostObligation} : {})};
  return hostObligation ? {...result,version:2,hostDisputeFeeCents:hostFee,hostObligation} : result;
}
export function marketplaceHostPrincipalExtinctionId(e: Pick<MarketplaceHostPrincipalExtinctionEvidence,"hostMerchantId"|"fundingPlanId"|"payoutId">) { return `mhost_extinction_${fundingHash([e.hostMerchantId,e.fundingPlanId,e.payoutId])}`; }
export function marketplaceOrderDisputeClosureId(e: Pick<MarketplaceOrderDisputeClosureEvidence,"hostMerchantId"|"fundingPlanId">) { return `morder_dispute_closure_${fundingHash([e.hostMerchantId,e.fundingPlanId])}`; }
export function marketplaceHostPrincipalExtinctionPayload(e: MarketplaceHostPrincipalExtinctionEvidence) {
  return {certificate_id:marketplaceHostPrincipalExtinctionId(e),payout_id:e.payoutId,funding_plan_id:e.fundingPlanId,host_merchant_id:e.hostMerchantId,
    provider_dispute_id:e.providerDisputeId,evidence_hash:fundingHash(e),principal_amount_cents:e.amountCents,host_dispute_fee_cents:e.hostDisputeFeeCents,
    fee_collection_state:"uncollected",funding_hold_released:false,payout_reauthorized:false};
}
export function marketplaceOrderDisputeClosurePayload(e: MarketplaceOrderDisputeClosureEvidence) {
  return {certificate_id:marketplaceOrderDisputeClosureId(e),funding_plan_id:e.fundingPlanId,host_merchant_id:e.hostMerchantId,provider_dispute_id:e.providerDisputeId,
    evidence_hash:fundingHash(e),principal_reinstated_cents:e.principalReinstatedCents,dispute_fee_cents:e.disputeFeeCents,host_dispute_fee_cents:e.hostDisputeFeeCents,
    collected_fee_cents:e.collectedFeeCents,processing_fee_cents:e.processingFeeCents,excess_liability_cents:0,original_funding_status:"held",
    operational_hold_closed:true,funding_hold_released:false,payout_reauthorized:false,...(e.version!==1 && e.hostObligation?{host_obligation_id:e.hostObligation.obligationId}:{})};
}
