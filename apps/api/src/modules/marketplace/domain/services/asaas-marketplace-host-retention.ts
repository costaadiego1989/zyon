import { asaasResidualHash,buildAsaasMarketplaceHostRetentionPrincipal,validAsaasResidualTransferProof } from './asaas-marketplace-residual.js';
import type {AsaasMarketplaceResidualFunding} from './asaas-marketplace-residual.js';
import type {MarketplaceRefundAllocation} from './marketplace-refund-allocation.js';
import type {buildMarketplaceFundingBudget} from './marketplace-funding-budget.js';
import type {AsaasMarketplaceHostRetentionBasis,AsaasMarketplaceHostRetentionAllocation,AsaasMarketplaceHostRetentionRequest,
  AsaasMarketplaceHostRetentionProof,AsaasMarketplaceHostRetentionOutboundRequest,AsaasMarketplaceHostRetentionOutboundProof} from '../ports/asaas-marketplace-host-retention.port.js';

type Budget=ReturnType<typeof buildMarketplaceFundingBudget>;
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const cents=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0&&Number(v)<=2_147_483_647;
export const asaasHostRetentionDate=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number(v.slice(0,4))>0&&
  Number.isFinite(Date.parse(v+'T00:00:00.000Z'))&&new Date(v+'T00:00:00.000Z').toISOString().slice(0,10)===v;
const observed=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/.test(v)&&asaasHostRetentionDate(v.slice(0,10));
function fail():never {throw Error('marketplace_asaas_host_retention_invalid');}
export const asaasHostRetentionJournalId=(requestHash:string)=>`ahretain_${requestHash}`;
export const asaasHostRetentionEventId=(journalId:string)=>`marketplace_asaas_host_retention_${journalId}`;

export function buildAsaasMarketplaceHostRetentionAllocation(budget:Budget,refunds:MarketplaceRefundAllocation[],funding:AsaasMarketplaceResidualFunding):AsaasMarketplaceHostRetentionAllocation {
  const principal=buildAsaasMarketplaceHostRetentionPrincipal(budget,refunds,funding);
  const host=principal.beneficiaries.find(b=>b.merchantId===funding.host.merchantId&&b.destination===funding.host.walletId);
  if(!host?.amountCents||!funding.originalPayouts.some(p=>p.merchantId===host.merchantId&&p.destination===host.destination)||
    funding.originalPayouts.some(p=>p.merchantId===host.merchantId&&(p.status!=='planned'||p.providerTransferId!==undefined)))fail();
  return {...principal,version:7,hostRetainedCents:host.amountCents,outboundPayoutCents:principal.payoutTotalCents-host.amountCents};
}
export function buildAsaasMarketplaceHostRetentionRequest(input:{basis:AsaasMarketplaceHostRetentionBasis;allocation:AsaasMarketplaceHostRetentionAllocation;capture:Budget['capture']}):AsaasMarketplaceHostRetentionRequest {
  const {basis,allocation,capture}=input,f=basis.asaasFunding;
  const account=f.destinationAccounts.find(a=>a.merchantId===f.host.merchantId&&a.walletId===f.host.walletId&&a.accountFingerprint===capture.accountFingerprint);
  if(basis.version!==7||allocation.version!==7||!account||!allocation.hostRetainedCents||
    allocation.payoutTotalCents!==allocation.hostRetainedCents+allocation.outboundPayoutCents)fail();
  const raw={version:7 as const,kind:'host_principal_retention' as const,provider:'asaas' as const,currency:'BRL' as const,paymentMethod:f.paymentMethod,
    fundingPlanId:basis.fundingPlanId,instructionsHash:basis.instructionsHash,budgetHash:basis.budgetHash,basisHash:asaasResidualHash(basis),allocationHash:asaasResidualHash(allocation),
    capture,host:{...account,environment:capture.environment},basis,allocation,amountCents:allocation.hostRetainedCents};
  const result={...raw,requestHash:asaasResidualHash(raw)};if(!validAsaasMarketplaceHostRetentionRequest(result))fail();return result;
}
export function validAsaasMarketplaceHostRetentionRequest(r:AsaasMarketplaceHostRetentionRequest):boolean {
  try {
    const {requestHash,...raw}=r,f=r.basis.asaasFunding,a=r.allocation,c=r.capture;
    const source=f.walletReturns[0]?.request.capture;
    return r.version===7&&r.kind==='host_principal_retention'&&r.provider==='asaas'&&r.currency==='BRL'&&['pix','card'].includes(r.paymentMethod)&&
      hash(requestHash)&&asaasResidualHash(raw)===requestHash&&[r.fundingPlanId,r.host.merchantId,r.host.walletId].every(id)&&
      [r.instructionsHash,r.budgetHash,r.basisHash,r.allocationHash,r.host.accountFingerprint,r.host.secretCipherHash].every(hash)&&
      r.basisHash===asaasResidualHash(r.basis)&&r.allocationHash===asaasResidualHash(a)&&r.basis.version===7&&a.version===7&&
      r.basis.fundingPlanId===r.fundingPlanId&&r.basis.instructionsHash===r.instructionsHash&&r.basis.budgetHash===r.budgetHash&&
      c.provider==='asaas'&&c.currency==='BRL'&&['test','live'].includes(c.environment)&&r.host.environment===c.environment&&
      c.accountFingerprint===r.host.accountFingerprint&&c.sourceId===c.providerPaymentId&&/^pay_[A-Za-z0-9_-]+$/.test(c.providerPaymentId)&&
      asaasResidualHash(c)===asaasResidualHash(source)&&r.paymentMethod===f.paymentMethod&&
      r.host.connectionId===asaasResidualHash({merchantId:r.host.merchantId,provider:'asaas'})&&
      r.host.merchantId===f.host.merchantId&&r.host.walletId===f.host.walletId&&r.host.accountFingerprint===f.host.accountFingerprint&&
      f.destinationAccounts.some(d=>asaasResidualHash({...d,environment:c.environment})===asaasResidualHash(r.host))&&
      new RegExp(`^https://api${c.environment==='test'?'-sandbox':''}\\.asaas\\.com(?:/|/v3|/v3/)?$`).test(r.host.asaasOrigin)&&
      [r.amountCents,c.amountCents,c.providerFeeCents,c.netAmountCents,a.refundedCents,a.platformRetainedCents,a.payoutTotalCents,a.hostRetainedCents,a.outboundPayoutCents].every(cents)&&
      r.amountCents>0&&r.amountCents===a.hostRetainedCents&&c.amountCents-c.providerFeeCents===c.netAmountCents&&
      a.capturedNetCents===c.netAmountCents&&a.refundedCents+a.platformRetainedCents+a.payoutTotalCents===a.capturedNetCents&&
      a.payoutTotalCents===a.hostRetainedCents+a.outboundPayoutCents&&
      a.beneficiaries.filter(b=>b.destination===f.host.walletId&&b.amountCents>0).length===1&&
      a.beneficiaries.some(b=>b.merchantId===f.host.merchantId&&b.destination===f.host.walletId&&b.amountCents===a.hostRetainedCents)&&
      a.beneficiaries.reduce((s,b)=>s+b.amountCents,0)===a.payoutTotalCents&&
      r.basis.refunds.length>0&&r.basis.refunds.reduce((s,b)=>s+b.amountCents,0)===a.refundedCents;
  } catch{return false;}
}
export function validAsaasMarketplaceHostRetentionProof(r:AsaasMarketplaceHostRetentionRequest,p:AsaasMarketplaceHostRetentionProof,now?:Date):boolean {
  try {
    if(!validAsaasMarketplaceHostRetentionRequest(r)||p.version!==7||p.kind!=='host_principal_retention'||p.association!=='local_immutable_host_retention_journal'||
      p.requestHash!==r.requestHash||p.providerPaymentId!==r.capture.providerPaymentId||p.hostAccountFingerprint!==r.host.accountFingerprint||p.hostWalletId!==r.host.walletId||
      p.amountCents!==r.amountCents||p.capturedGrossCents!==r.capture.amountCents||p.processingFeeCents!==r.capture.providerFeeCents||p.refundedCents!==r.allocation.refundedCents||
      !asaasHostRetentionDate(p.paymentCreatedDate)||!observed(p.observedAt)||(now&&(Date.parse(p.observedAt)<now.getTime()-300000||Date.parse(p.observedAt)>now.getTime()+60000))||
      !Array.isArray(p.processingFees)||p.processingFees.length>2000||!Array.isArray(p.buyerRefundDebits)||p.buyerRefundDebits.length!==r.basis.refunds.length) return false;
    const entries=[p.captureCredit,...p.processingFees,...p.buyerRefundDebits],sourceIds=r.basis.asaasFunding.walletReturns.flatMap(c=>
      [c.proof.originalHostDebit.id,c.proof.originalSellerCredit.id,c.proof.sellerReturnDebit.id,c.proof.hostReturnCredit.id]);
    if(new Set(entries.map(e=>e?.id)).size!==entries.length||entries.some(e=>!e||!id(e.id)||sourceIds.includes(e.id)||e.paymentId!==r.capture.providerPaymentId||
      !asaasHostRetentionDate(e.date)||e.date<p.paymentCreatedDate||e.date>p.observedAt.slice(0,10)||!Number.isSafeInteger(e.amountCents)||Math.abs(e.amountCents)>2147483647))return false;
    return p.captureCredit.type==='PAYMENT_RECEIVED'&&p.captureCredit.amountCents===r.capture.amountCents&&
      p.processingFees.every(e=>e.type==='PAYMENT_FEE'&&e.amountCents<0)&&p.processingFees.reduce((s,e)=>s-e.amountCents,0)===r.capture.providerFeeCents&&
      p.buyerRefundDebits.every(e=>e.type==='PAYMENT_REVERSAL'&&e.amountCents<0&&e.date>=p.captureCredit.date)&&
      asaasResidualHash(p.buyerRefundDebits.map(e=>-e.amountCents).sort((a,b)=>a-b))===asaasResidualHash(r.basis.refunds.map(e=>e.amountCents).sort((a,b)=>a-b))&&
      r.basis.asaasFunding.walletReturns.every(c=>c.proof.hostReturnCredit.date<=p.observedAt.slice(0,10));
  } catch{return false;}
}
export function buildAsaasMarketplaceHostRetentionOutboundRequest(input:{retention:AsaasMarketplaceHostRetentionRequest;beneficiaryMerchantId:string}):AsaasMarketplaceHostRetentionOutboundRequest {
  const r=input.retention,a=r.allocation,b=a.beneficiaries.find(b=>b.merchantId===input.beneficiaryMerchantId);
  if(!validAsaasMarketplaceHostRetentionRequest(r)||!b?.amountCents||b.destination===r.host.walletId)fail();
  const reference=(merchantId:string)=>`mresidual_${asaasResidualHash([r.host.merchantId,r.fundingPlanId,r.basisHash,merchantId])}`;
  const raw={version:7 as const,provider:'asaas' as const,fundingPlanId:r.fundingPlanId,beneficiaryMerchantId:b.merchantId,basisHash:r.basisHash,allocationHash:r.allocationHash,
    accountFingerprint:r.host.accountFingerprint,providerPaymentId:r.capture.providerPaymentId,destination:b.destination,amountCents:b.amountCents,currency:'BRL' as const,
    reference:reference(b.merchantId),capture:r.capture,asaasFunding:r.basis.asaasFunding,residualAllocation:a,remainingTotalCents:a.outboundPayoutCents,
    refunds:r.basis.refunds.map(v=>({providerOperationId:v.providerOperationId,amountCents:v.amountCents})),
    transfers:a.beneficiaries.filter(v=>v.amountCents>0&&v.destination!==r.host.walletId).map(v=>({reference:reference(v.merchantId),destination:v.destination,amountCents:v.amountCents})),
    hostRetention:{journalId:asaasHostRetentionJournalId(r.requestHash),requestHash:r.requestHash}};
  return {...raw,requestHash:asaasResidualHash(raw)};
}
export function validAsaasHostRetentionOutboundProof(r:AsaasMarketplaceHostRetentionOutboundRequest,p:AsaasMarketplaceHostRetentionOutboundProof,now?:Date):boolean {
  // The physical two-account receipt remains V5; V7 changes source accounting.
  return validAsaasResidualTransferProof({...r,version:5,residualAllocation:{...r.residualAllocation,version:5}},p,now);
}
