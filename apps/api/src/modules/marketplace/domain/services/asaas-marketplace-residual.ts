import { createHash } from "node:crypto";
import type { AsaasMarketplaceWalletReturnProof, AsaasMarketplaceWalletReturnRequest } from "../ports/asaas-marketplace-transfer-recovery.port.js";
import type { AsaasMarketplaceResidualRequest,AsaasMarketplaceResidualTransferProof } from "../ports/asaas-marketplace-residual.port.js";
import type { MarketplaceResidualBasisV1, MarketplaceResidualAllocationV1 } from "./marketplace-residual-allocation.js";
import { buildMarketplaceResidualAllocation } from "./marketplace-residual-allocation.js";
import type { MarketplaceRefundAllocation } from "./marketplace-refund-allocation.js";
import type { buildMarketplaceFundingBudget } from "./marketplace-funding-budget.js";

type Budget = ReturnType<typeof buildMarketplaceFundingBudget>;
export interface AsaasMarketplaceResidualCertificate {
  id: string; payoutId: string; amountCents: number; certificateHash: string; requestHash: string;
  providerTransferId: string; request: AsaasMarketplaceWalletReturnRequest; proof: AsaasMarketplaceWalletReturnProof;
}
export interface AsaasMarketplaceResidualFunding {
  host: { merchantId: string; accountFingerprint: string; walletId: string };
  paymentMethod: "pix" | "card";
  destinationAccounts: Array<{merchantId:string;accountFingerprint:string;walletId:string;asaasOrigin:string;connectionId:string;secretCipherHash:string}>;
  originalPayouts: Array<{ id: string; merchantId: string; destination: string; amountCents: number;
    status: "planned" | "confirmed"; providerTransferId?: string }>;
  walletReturns: AsaasMarketplaceResidualCertificate[];
}
export interface AsaasMarketplaceResidualBasis extends Omit<MarketplaceResidualBasisV1, "version"> {
  version: 5;
  asaasFunding: AsaasMarketplaceResidualFunding;
}
export interface AsaasMarketplaceResidualAllocation extends Omit<MarketplaceResidualAllocationV1, "version"> {
  version: 5;
  /** No aggregate balance or contribution is a spendable source. */
  returnedPrincipalCents: number;
  heldOriginalPrincipalCents: number;
}
export function asaasResidualHash(value: unknown): string {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object"
    ? Object.fromEntries(Object.keys(v).sort().map(key => [key, canonical((v as Record<string, unknown>)[key])])) : v;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
const identifier = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const cents = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= 2_147_483_647;
const calendarDate = (v: unknown): v is string => typeof v === "string" && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v) &&
  Number(v.slice(0,4)) > 0 && Number.isFinite(Date.parse(`${v}T00:00:00.000Z`)) && new Date(`${v}T00:00:00.000Z`).toISOString().slice(0,10) === v;
const observedTimestamp = (v: unknown): v is string => typeof v === "string" &&
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]{1,3})?Z$/.test(v) &&
  calendarDate(v.slice(0,10)) && Number.isFinite(Date.parse(v));
const fail = (reason = "marketplace_asaas_residual_funding_invalid"): never => { throw Error(reason); };

export function validAsaasResidualCertificate(c: AsaasMarketplaceResidualCertificate): boolean {
  try {
    const r = c.request, p = c.proof, { reference, requestHash, ...raw } = r;
    if (!identifier(c.id) || !identifier(c.payoutId) || !identifier(c.providerTransferId) || !hash(c.certificateHash) ||
      c.certificateHash !== asaasResidualHash({ request: r, proof: p }) || requestHash !== c.requestHash || !hash(requestHash) ||
      asaasResidualHash(raw) !== requestHash || reference !== `mwreturn_${requestHash}` ||
      r.version !== 1 || r.kind !== "authorized_wallet_return" || r.provider !== "asaas" || r.currency !== "BRL" ||
      !["test", "live"].includes(r.environment) || !["pix", "card"].includes(r.paymentMethod) ||
      ![r.host.merchantId,r.host.walletId,r.seller.merchantId,r.seller.walletId,r.authorization.id,r.authorization.actorId,
        r.refundPlanId,r.fundingPlanId,r.returnId,r.originalPayout.id,r.originalPayout.providerTransferId].every(identifier) ||
      ![r.host.accountFingerprint,r.seller.accountFingerprint,r.instructionsHash,r.allocationHash].every(hash) ||
      r.host.merchantId === r.seller.merchantId || r.host.walletId === r.seller.walletId || r.host.accountFingerprint === r.seller.accountFingerprint ||
      r.authorization.sellerMerchantId !== r.seller.merchantId || !observedTimestamp(r.authorization.authorizedAt) ||
      r.capture.provider !== "asaas" || r.capture.environment !== r.environment || r.capture.currency !== "BRL" ||
      r.capture.accountFingerprint !== r.host.accountFingerprint || r.capture.sourceId !== r.capture.providerPaymentId ||
      !/^pay_[A-Za-z0-9_-]+$/.test(r.capture.providerPaymentId) || !cents(r.capture.amountCents) || !cents(r.capture.providerFeeCents) ||
      !cents(r.capture.netAmountCents) || r.capture.amountCents-r.capture.providerFeeCents !== r.capture.netAmountCents ||
      !cents(c.amountCents) || !c.amountCents || r.amountCents !== c.amountCents || r.originalPayout.amountCents !== c.amountCents ||
      r.originalPayout.id !== c.payoutId || !r.originalPayout.reference || !calendarDate(r.originalPayout.dateCreated) ||
      p.version !== 1 || p.kind !== "authorized_wallet_return" || p.association !== "local_immutable_authorization" ||
      p.requestHash !== requestHash || p.reference !== reference || p.authorizationId !== r.authorization.id ||
      p.originalProviderTransferId !== r.originalPayout.providerTransferId || p.providerTransferId !== c.providerTransferId ||
      p.providerTransferId === p.originalProviderTransferId || p.hostAccountFingerprint !== r.host.accountFingerprint ||
      p.sellerAccountFingerprint !== r.seller.accountFingerprint || p.hostWalletId !== r.host.walletId || p.sellerWalletId !== r.seller.walletId ||
      p.amountCents !== c.amountCents || !observedTimestamp(p.observedAt)) return false;
    const entries = [[p.originalHostDebit,p.originalProviderTransferId,"INTERNAL_TRANSFER_DEBIT",-c.amountCents],
      [p.originalSellerCredit,p.originalProviderTransferId,"INTERNAL_TRANSFER_CREDIT",c.amountCents],
      [p.sellerReturnDebit,p.providerTransferId,"INTERNAL_TRANSFER_DEBIT",-c.amountCents],
      [p.hostReturnCredit,p.providerTransferId,"INTERNAL_TRANSFER_CREDIT",c.amountCents]] as const;
    return new Set(entries.map(([e])=>e?.id)).size === 4 && entries.every(([e,transferId,type,amount])=>
      e && identifier(e.id) && e.transferId === transferId && e.type === type && e.amountCents === amount &&
      calendarDate(e.date));
  } catch { return false; }
}

/** Replays seller debits once against the original net budget. Whole returned
 * payouts and original unsubmitted principal are disjoint funding evidence;
 * processing fees, debts and foreign money never become residual credit. */
export function buildAsaasMarketplaceResidualAllocation(budget: Budget, refunds: MarketplaceRefundAllocation[],
  funding: AsaasMarketplaceResidualFunding): AsaasMarketplaceResidualAllocation {
  return buildAsaasMarketplaceResidualPrincipal(budget,refunds,funding,false);
}

/** V7 alone may account for the collector's own entitlement. This is still
 * source validation, never evidence of a native retention or completion. */
export function buildAsaasMarketplaceHostRetentionPrincipal(budget: Budget, refunds: MarketplaceRefundAllocation[],
  funding: AsaasMarketplaceResidualFunding): AsaasMarketplaceResidualAllocation {
  return buildAsaasMarketplaceResidualPrincipal(budget,refunds,funding,true);
}

function buildAsaasMarketplaceResidualPrincipal(budget: Budget, refunds: MarketplaceRefundAllocation[],
  funding: AsaasMarketplaceResidualFunding,hostRetention:boolean): AsaasMarketplaceResidualAllocation {
  const h = funding.host, payouts = funding.originalPayouts, certificates = funding.walletReturns;
  if (budget.capture.provider !== "asaas" || !identifier(h.merchantId) || !identifier(h.walletId) ||
    h.accountFingerprint !== budget.capture.accountFingerprint || !["pix","card"].includes(funding.paymentMethod) ||
    !Array.isArray(payouts) || !payouts.length || payouts.length > 2000 || !Array.isArray(certificates) || !certificates.length ||
    certificates.length > 2000 || !Array.isArray(funding.destinationAccounts) ||
    new Set(funding.destinationAccounts.map(a=>a.merchantId)).size!==funding.destinationAccounts.length ||
    funding.destinationAccounts.some(a=>!identifier(a.merchantId)||!identifier(a.walletId)||!hash(a.accountFingerprint)||
      a.connectionId!==asaasResidualHash({merchantId:a.merchantId,provider:"asaas"})||!hash(a.secretCipherHash)||
      !budget.beneficiaries.some(b=>b.merchantId===a.merchantId&&b.destination===a.walletId)||
      !new RegExp(`^https://api${budget.capture.environment==="test"?"-sandbox":""}\\.asaas\\.com(?:/|/v3|/v3/)?$`).test(a.asaasOrigin)) ||
    new Set(payouts.map(p=>p.id)).size !== payouts.length ||
    new Set(certificates.map(c=>c.id)).size !== certificates.length || new Set(certificates.map(c=>c.payoutId)).size !== certificates.length ||
    new Set(certificates.map(c=>c.providerTransferId)).size !== certificates.length ||
    new Set(certificates.flatMap(c=>[c.proof.originalHostDebit.id,c.proof.originalSellerCredit.id,c.proof.sellerReturnDebit.id,c.proof.hostReturnCredit.id])).size !== certificates.length*4 ||
    payouts.some(p=>!identifier(p.id)||!identifier(p.merchantId)||!identifier(p.destination)||!cents(p.amountCents)||!p.amountCents||
      !(p.status === "planned" && p.providerTransferId === undefined || p.status === "confirmed" && identifier(p.providerTransferId))||
      !budget.beneficiaries.some(b=>b.merchantId === p.merchantId && b.destination === p.destination)) ||
    budget.beneficiaries.some(b=>payouts.filter(p=>p.merchantId === b.merchantId).reduce((s,p)=>s+p.amountCents,0)!==b.amountCents) ||
    certificates.some(c=>{const p=payouts.find(p=>p.id===c.payoutId),r=c.request;
      return !validAsaasResidualCertificate(c)||!p||p.status!=="confirmed"||c.amountCents!==p.amountCents||
        r.originalPayout.providerTransferId!==p.providerTransferId||r.seller.merchantId!==p.merchantId||r.seller.walletId!==p.destination||
        asaasResidualHash(r.host)!==asaasResidualHash(h)||r.paymentMethod!==funding.paymentMethod||
        asaasResidualHash(r.capture)!==asaasResidualHash(budget.capture)||
        !funding.destinationAccounts.some(a=>a.merchantId===p.merchantId&&a.walletId===p.destination&&a.accountFingerprint===r.seller.accountFingerprint);}) ||
    payouts.some(p=>p.status==="confirmed"&&!certificates.some(c=>c.payoutId===p.id))) fail();
  const remaining=buildMarketplaceResidualAllocation(budget,refunds);
  if (remaining.beneficiaries.some(b=>b.amountCents>0&&!funding.destinationAccounts.some(a=>a.merchantId===b.merchantId&&a.walletId===b.destination))) fail();
  // An INTERNAL self-transfer is not a documented retention receipt. A plan
  // with this liability cannot pay other beneficiaries and then never close.
  if (remaining.beneficiaries.some(b=>b.amountCents>0&&b.destination===h.walletId&&(!hostRetention||b.merchantId!==h.merchantId||
    !funding.destinationAccounts.some(a=>a.merchantId===h.merchantId&&a.walletId===h.walletId&&a.accountFingerprint===h.accountFingerprint)))) {
    fail("marketplace_asaas_residual_self_wallet_retention_required");
  }
  const returnedPrincipalCents=certificates.reduce((s,c)=>s+c.amountCents,0),
    heldOriginalPrincipalCents=payouts.filter(p=>p.status==="planned").reduce((s,p)=>s+p.amountCents,0);
  if (!cents(returnedPrincipalCents)||!cents(heldOriginalPrincipalCents)||
    returnedPrincipalCents+heldOriginalPrincipalCents!==budget.payoutTotalCents) fail();
  return {...remaining,version:5,returnedPrincipalCents,heldOriginalPrincipalCents};
}

export function buildAsaasMarketplaceResidualRequest(input: { basis: AsaasMarketplaceResidualBasis; allocation: AsaasMarketplaceResidualAllocation;
  capture: Budget["capture"]; beneficiaryMerchantId: string }): AsaasMarketplaceResidualRequest {
  const {basis,allocation,capture}=input;
  const beneficiary=allocation.beneficiaries.find(b=>b.merchantId===input.beneficiaryMerchantId);
  if (basis.version!==5||allocation.version!==5||!beneficiary||!beneficiary.amountCents||
    allocation.payoutTotalCents<=0||asaasResidualHash(capture)!==asaasResidualHash(basis.asaasFunding.walletReturns[0]?.request.capture)) fail();
  const basisHash=asaasResidualHash(basis),allocationHash=asaasResidualHash(allocation);
  const reference=(merchantId:string)=>`mresidual_${asaasResidualHash([basis.asaasFunding.host.merchantId,basis.fundingPlanId,basisHash,merchantId])}`;
  const raw={version:5 as const,provider:"asaas" as const,fundingPlanId:basis.fundingPlanId,beneficiaryMerchantId:beneficiary!.merchantId,basisHash,allocationHash,
    accountFingerprint:capture.accountFingerprint,providerPaymentId:capture.providerPaymentId,destination:beneficiary!.destination,
    amountCents:beneficiary!.amountCents,currency:"BRL" as const,reference:reference(beneficiary!.merchantId),capture,
    asaasFunding:basis.asaasFunding,residualAllocation:allocation,remainingTotalCents:allocation.payoutTotalCents,
    refunds:basis.refunds.map(r=>({providerOperationId:r.providerOperationId,amountCents:r.amountCents})),
    transfers:allocation.beneficiaries.filter(b=>b.amountCents>0).map(b=>({reference:reference(b.merchantId),destination:b.destination,amountCents:b.amountCents}))};
  return {...raw,requestHash:asaasResidualHash(raw)};
}

export function validAsaasResidualTransferProof(r:AsaasMarketplaceResidualRequest,p:AsaasMarketplaceResidualTransferProof,now?:Date):boolean {
  try {
    const destination=r.asaasFunding.destinationAccounts.find(a=>a.merchantId===r.beneficiaryMerchantId&&a.walletId===r.destination);
    const sourceIds=r.asaasFunding.walletReturns.flatMap(c=>[c.proof.originalHostDebit.id,c.proof.originalSellerCredit.id,c.proof.sellerReturnDebit.id,c.proof.hostReturnCredit.id]);
    return !!destination&&p.version===5&&p.kind==="residual_payout"&&p.association==="local_immutable_residual_journal"&&
      p.requestHash===r.requestHash&&p.reference===r.reference&&identifier(p.providerTransferId)&&p.amountCents===r.amountCents&&
      p.hostAccountFingerprint===r.accountFingerprint&&p.sellerAccountFingerprint===destination.accountFingerprint&&
      p.hostAccountFingerprint!==p.sellerAccountFingerprint&&
      p.hostWalletId===r.asaasFunding.host.walletId&&p.sellerWalletId===r.destination&&p.hostWalletId!==p.sellerWalletId&&
      observedTimestamp(p.observedAt)&&(!now||Date.parse(p.observedAt)>=now.getTime()-300_000&&Date.parse(p.observedAt)<=now.getTime()+60_000)&&
      !r.asaasFunding.walletReturns.some(c=>c.providerTransferId===p.providerTransferId||c.request.originalPayout.providerTransferId===p.providerTransferId)&&
      p.hostDebit.id!==p.sellerCredit.id&&
      !sourceIds.includes(p.hostDebit.id)&&!sourceIds.includes(p.sellerCredit.id)&&
      [[p.hostDebit,"INTERNAL_TRANSFER_DEBIT",-r.amountCents],[p.sellerCredit,"INTERNAL_TRANSFER_CREDIT",r.amountCents]].every(([entry,type,amount])=>{
        const e=entry as AsaasMarketplaceWalletReturnProof["hostReturnCredit"];
        return identifier(e.id)&&e.transferId===p.providerTransferId&&e.type===type&&e.amountCents===amount&&
          calendarDate(e.date)&&e.date<=p.observedAt.slice(0,10)&&
          r.asaasFunding.walletReturns.every(c=>calendarDate(c.proof.hostReturnCredit.date)&&e.date>=c.proof.hostReturnCredit.date);});
  } catch {return false;}
}
