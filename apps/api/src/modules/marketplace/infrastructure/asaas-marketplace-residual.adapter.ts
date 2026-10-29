import type { MarketplaceResidualObservation } from "../domain/ports/marketplace-residual-provider.port.js";
import type { AsaasMarketplaceResidualRequest,AsaasMarketplaceResidualProvider,AsaasMarketplaceResidualAuthorizationReader,
  AsaasMarketplaceResidualAccountReader,AsaasMarketplaceResidualWalletReturnVerifier,AsaasMarketplaceResidualTransferProof } from "../domain/ports/asaas-marketplace-residual.port.js";
import type { AsaasMarketplaceWalletReturnLedgerReceipt } from "../domain/ports/asaas-marketplace-transfer-recovery.port.js";
import { asaasResidualHash,validAsaasResidualCertificate } from "../domain/services/asaas-marketplace-residual.js";
import { marketplaceCaptureAccount } from "./marketplace-capture-account.js";
import { asaasMarketplaceRefundReceiptId } from "./asaas-marketplace-refund.adapter.js";
import type {AsaasMarketplaceHostRetentionOutboundRequest,AsaasMarketplaceHostRetentionReader,AsaasMarketplaceHostRetentionVerifier,AsaasMarketplaceHostRetentionProof} from '../domain/ports/asaas-marketplace-host-retention.port.js';
import {buildAsaasMarketplaceHostRetentionOutboundRequest,validAsaasMarketplaceHostRetentionProof} from '../domain/services/asaas-marketplace-host-retention.js';

type Account={asaasKey?:string;asaasOrigin?:string};
type Request=AsaasMarketplaceResidualRequest|AsaasMarketplaceHostRetentionOutboundRequest;
type Context={host:Account;seller:Account};
type Json=Record<string,unknown>;
const object=(v:unknown):v is Json=>!!v&&typeof v==="object"&&!Array.isArray(v);
const identifier=(v:unknown):v is string=>typeof v==="string"&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
const hash=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v);
const cents=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0&&Number(v)<=2_147_483_647;
const absent=(v:unknown)=>v===undefined||v===null;
const date=(v:unknown):v is string=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
function fail(code="marketplace_asaas_residual_provider_evidence_invalid"):never {throw Error(code);}
const money=(v:unknown):number=>{
  if (typeof v!=="number"||!Number.isFinite(v)||Math.abs(v)>21_474_836.47) return fail();
  const result=Math.round(v*100);if(Math.abs(v*100-result)>0.000001)return fail();return result;
};

/** First residual distribution from certified original principal. Asaas
 * externalReference is a local immutable association, not PSP capture-source
 * proof or native idempotency. One durably consumed permit precedes one POST;
 * unknown outcomes and restarts can only inspect GET receipts/statements. */
export class AsaasMarketplaceResidualAdapter implements AsaasMarketplaceResidualProvider {
  constructor(private readonly hostConfig:Account,private readonly request:typeof fetch=globalThis.fetch,
    private readonly authorization?:AsaasMarketplaceResidualAuthorizationReader,
    private readonly accounts?:AsaasMarketplaceResidualAccountReader,
    private readonly walletReturns?:AsaasMarketplaceResidualWalletReturnVerifier,
    private readonly now:()=>Date=()=>new Date(),private readonly retention?:AsaasMarketplaceHostRetentionReader,
    private readonly retentionVerifier?:AsaasMarketplaceHostRetentionVerifier) {}

  private validate(input:Request):void {
    const {requestHash,...raw}=input,capture=input.capture,f=input.asaasFunding,a=input.residualAllocation;
    if (![5,7].includes(input.version)||input.provider!=="asaas"||input.currency!=="BRL"||!hash(requestHash)||asaasResidualHash(raw)!==requestHash||
      !identifier(input.fundingPlanId)||!identifier(input.beneficiaryMerchantId)||!hash(input.basisHash)||!hash(input.allocationHash)||
      input.reference!==`mresidual_${asaasResidualHash([f.host.merchantId,input.fundingPlanId,input.basisHash,input.beneficiaryMerchantId])}`||
      capture.provider!=="asaas"||!["test","live"].includes(capture.environment)||capture.currency!=="BRL"||
      capture.providerPaymentId!==input.providerPaymentId||capture.sourceId!==input.providerPaymentId||!/^pay_[A-Za-z0-9_-]+$/.test(input.providerPaymentId)||
      capture.accountFingerprint!==input.accountFingerprint||f.host.accountFingerprint!==input.accountFingerprint||
      !identifier(f.host.merchantId)||!identifier(f.host.walletId)||!["pix","card"].includes(f.paymentMethod)||
      !cents(input.amountCents)||!input.amountCents||!cents(capture.amountCents)||!cents(capture.netAmountCents)||
      !cents(capture.providerFeeCents)||capture.amountCents-capture.providerFeeCents!==capture.netAmountCents||
      'sourceId' in input||'sourceAllocation' in input||'fundingContributions' in input||'sourceTransfers' in input||
      'originalTransfers' in input||'previousGenerations' in input||
      a.version!==input.version||asaasResidualHash(a)!==input.allocationHash||a.capturedNetCents!==capture.netAmountCents||
      ![a.refundedCents,a.platformRetainedCents,a.payoutTotalCents,a.returnedPrincipalCents,a.heldOriginalPrincipalCents].every(cents)||
      a.refundedCents+a.platformRetainedCents+a.payoutTotalCents!==a.capturedNetCents||
      !Array.isArray(input.refunds)||!input.refunds.length||input.refunds.length>2000||
      new Set(input.refunds.map(r=>r.providerOperationId)).size!==input.refunds.length||
      input.refunds.some(r=>!/^asaas_refund_[a-f0-9]{64}$/.test(r.providerOperationId)||!cents(r.amountCents)||!r.amountCents)||
      input.refunds.reduce((s,r)=>s+r.amountCents,0)!==a.refundedCents||
      !Array.isArray(a.beneficiaries)||!a.beneficiaries.length||new Set(a.beneficiaries.map(b=>b.merchantId)).size!==a.beneficiaries.length||
      a.beneficiaries.some(b=>!identifier(b.merchantId)||!identifier(b.destination)||!cents(b.amountCents)||!cents(b.providerFeeCents)||
        b.amountCents>0&&b.destination===f.host.walletId&&(input.version===5||b.merchantId!==f.host.merchantId))||
      a.beneficiaries.reduce((s,b)=>s+b.amountCents,0)!==a.payoutTotalCents||input.remainingTotalCents!==(a.version===7?a.outboundPayoutCents:a.payoutTotalCents)||
      !a.beneficiaries.some(b=>b.merchantId===input.beneficiaryMerchantId&&b.destination===input.destination&&b.amountCents===input.amountCents)||
      !Array.isArray(input.transfers)||input.transfers.length!==a.beneficiaries.filter(b=>b.amountCents>0&&b.destination!==f.host.walletId).length||
      new Set(input.transfers.map(t=>t.reference)).size!==input.transfers.length||
      new Set(input.transfers.map(t=>t.destination)).size!==input.transfers.length||
      a.beneficiaries.filter(b=>b.amountCents>0&&b.destination!==f.host.walletId).some(b=>!input.transfers.some(t=>t.destination===b.destination&&t.amountCents===b.amountCents&&
        t.reference===`mresidual_${asaasResidualHash([f.host.merchantId,input.fundingPlanId,input.basisHash,b.merchantId])}`))||
      !Array.isArray(f.walletReturns)||!f.walletReturns.length||f.walletReturns.some(c=>!validAsaasResidualCertificate(c)||
        c.request.fundingPlanId!==input.fundingPlanId||asaasResidualHash(c.request.host)!==asaasResidualHash(f.host)||
        asaasResidualHash(c.request.capture)!==asaasResidualHash(capture)||c.request.paymentMethod!==f.paymentMethod)||
      new Set(f.walletReturns.map(c=>c.payoutId)).size!==f.walletReturns.length||
      !Array.isArray(f.originalPayouts)||!f.originalPayouts.length||new Set(f.originalPayouts.map(p=>p.id)).size!==f.originalPayouts.length||
      f.originalPayouts.some(p=>!identifier(p.id)||!identifier(p.merchantId)||!identifier(p.destination)||!cents(p.amountCents)||!p.amountCents||
        !(p.status==="planned"&&p.providerTransferId===undefined||p.status==="confirmed"&&identifier(p.providerTransferId))||
        p.status==="confirmed"&&!f.walletReturns.some(c=>c.payoutId===p.id&&c.amountCents===p.amountCents&&
          c.request.seller.merchantId===p.merchantId&&c.request.seller.walletId===p.destination&&c.request.originalPayout.providerTransferId===p.providerTransferId))||
      f.walletReturns.some(c=>!f.originalPayouts.some(p=>p.id===c.payoutId&&p.status==="confirmed"))||
      f.walletReturns.reduce((s,c)=>s+c.amountCents,0)!==a.returnedPrincipalCents||
      f.originalPayouts.filter(p=>p.status==="planned").reduce((s,p)=>s+p.amountCents,0)!==a.heldOriginalPrincipalCents||
      !Array.isArray(f.destinationAccounts)||new Set(f.destinationAccounts.map(a=>a.merchantId)).size!==f.destinationAccounts.length||
      a.beneficiaries.filter(b=>b.amountCents>0).some(b=>!f.destinationAccounts.some(d=>d.merchantId===b.merchantId&&d.walletId===b.destination&&hash(d.accountFingerprint)))) fail();
    if(input.version===7&&(a.version!==7||!cents(a.hostRetainedCents)||!a.hostRetainedCents||!cents(a.outboundPayoutCents)||
      a.payoutTotalCents!==a.hostRetainedCents+a.outboundPayoutCents||input.destination===f.host.walletId||
      !a.beneficiaries.some(b=>b.merchantId===f.host.merchantId&&b.destination===f.host.walletId&&b.amountCents===a.hostRetainedCents)||
      !f.destinationAccounts.some(d=>d.merchantId===f.host.merchantId&&d.walletId===f.host.walletId&&d.accountFingerprint===f.host.accountFingerprint)||
      !input.hostRetention||!hash(input.hostRetention.requestHash)||input.hostRetention.journalId!==`ahretain_${input.hostRetention.requestHash}`))fail();
    if (marketplaceCaptureAccount("asaas",capture.environment,this.hostConfig.asaasKey,this.hostConfig.asaasOrigin).accountFingerprint!==input.accountFingerprint) fail();
  }
  private async context(input:Request):Promise<Context> {
    const account=input.asaasFunding.destinationAccounts.find(a=>a.merchantId===input.beneficiaryMerchantId&&a.walletId===input.destination);
    if (!account||!this.accounts) return fail();
    const seller=await this.accounts.read({...account,environment:input.capture.environment});
    if (!seller||marketplaceCaptureAccount("asaas",input.capture.environment,seller.asaasKey,seller.asaasOrigin).accountFingerprint!==account.accountFingerprint) return fail();
    return {host:this.hostConfig,seller};
  }
  private async wallets(input:Request,context:Context):Promise<void> {
    for (const role of ["host","seller"] as const) {
      const result=await this.json(context[role],"/wallets/");
      if (result.object!=="list"||result.hasMore!==false||result.totalCount!==1||!Array.isArray(result.data)||result.data.length!==1||
        !object(result.data[0])||result.data[0].object!=="wallet"||result.data[0].id!==(role==="host"?input.asaasFunding.host.walletId:input.destination)) fail();
    }
  }
  private async payment(input:Request):Promise<string> {
    const p=await this.json(this.hostConfig,`/payments/${encodeURIComponent(input.providerPaymentId)}`);
    const receipts=p.refunds;
    if (p.id!==input.providerPaymentId||p.status!=="RECEIVED"||p.billingType!==(input.asaasFunding.paymentMethod==="pix"?"PIX":"CREDIT_CARD")||
      money(p.value)!==input.capture.amountCents||p.deleted===true||p.anticipated===true||!absent(p.chargeback)||!absent(p.installment)||!absent(p.subscription)||
      !absent(p.split)&&(!Array.isArray(p.split)||p.split.length)||!Array.isArray(receipts)||receipts.length!==input.refunds.length||
      p.refundedValue!==undefined&&money(p.refundedValue)!==input.residualAllocation.refundedCents) fail();
    const expected=new Map(input.refunds.map(r=>[r.providerOperationId,r.amountCents]));
    for (const r of receipts) {
      if (!object(r)||r.status!=="DONE"||typeof r.description!=="string"||!r.description||typeof r.dateCreated!=="string"||
        !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(r.dateCreated)||!Number.isFinite(Date.parse(r.dateCreated.replace(" ","T")+"Z"))||
        !absent(r.refundedSplits)&&(!Array.isArray(r.refundedSplits)||r.refundedSplits.length)) fail();
      const key=asaasMarketplaceRefundReceiptId(input.capture,r as {description:string;dateCreated:string;value:number});
      if (expected.get(key)!==money(r.value)) fail();expected.delete(key);
    }
    if (expected.size) fail();
    return asaasResidualHash({id:p.id,value:p.value,status:p.status,billingType:p.billingType,refunds:receipts});
  }
  private async sourceProof(input:Request):Promise<void> {
    if (!this.walletReturns) fail();
    for (const c of input.asaasFunding.walletReturns) {
      const result=await this.walletReturns!.reconcile(c.request,c.providerTransferId);
      if (result.state!=="returned"||result.providerTransferId!==c.providerTransferId||result.amountCents!==c.amountCents) fail();
      const {observedAt:_old,...frozen}=c.proof,{observedAt:_new,...current}=result.proof;
      if (asaasResidualHash(current)!==asaasResidualHash(frozen)) fail();
    }
  }
  private startDate(input:Request):string {
    return input.asaasFunding.walletReturns.map(c=>c.request.originalPayout.dateCreated).sort()[0]!;
  }
  private async transfers(input:Request):Promise<Json[]> {
    const rows=await this.list(this.hostConfig,`/transfers?type=ASAAS_ACCOUNT&dateCreated%5Bge%5D=${this.startDate(input)}`);
    const expected=input.transfers;
    for (const t of expected) {
      const candidates=rows.filter(r=>r.externalReference===t.reference);
      if (candidates.length>1) fail();
      if (candidates[0]) this.transfer(candidates[0],t.reference,t.destination,t.amountCents);
    }
    return rows;
  }
  private transfer(row:Json,reference:string,walletId:string,amountCents:number):void {
    if (row.object!=="transfer"||!identifier(row.id)||row.externalReference!==reference||row.type!=="INTERNAL"||row.operationType!=="INTERNAL"||
      money(row.value)!==amountCents||money(row.netValue)!==amountCents||money(row.transferFee)!==0||!date(row.dateCreated)||
      !absent(row.bankAccount)||!absent(row.recurring)||!absent(row.walletId)&&row.walletId!==walletId) fail();
  }
  private identity(row:Json):string {
    return asaasResidualHash(Object.fromEntries(["id","externalReference","type","operationType","dateCreated","effectiveDate","status",
      "authorized","value","netValue","transferFee","walletId"].map(key=>[key,row[key]])));
  }
  private async receipt(input:Request,context:Context,row:Json):Promise<MarketplaceResidualObservation> {
    this.transfer(row,input.reference,input.destination,input.amountCents);
    const base={providerTransferId:String(row.id),amountCents:input.amountCents,observedAt:this.now().toISOString()};
    const host=await this.list(context.host,`/financialTransactions?startDate=${this.startDate(input)}&order=asc`),
      seller=await this.list(context.seller,`/financialTransactions?startDate=${this.startDate(input)}&order=asc`);
    const debits=host.filter(r=>r.transferId===row.id),credits=seller.filter(r=>r.transferId===row.id);
    if (["CANCELLED","FAILED"].includes(String(row.status))) return !debits.length&&!credits.length?{state:"failed",...base}:{state:"unknown"};
    if (["PENDING","BANK_PROCESSING"].includes(String(row.status))) return {state:"pending",...base};
    if (row.status!=="DONE"||row.authorized!==true||!date(row.effectiveDate)) return {state:"unknown"};
    const debit=this.entry(debits,String(row.id),"INTERNAL_TRANSFER_DEBIT",-input.amountCents),
      credit=this.entry(credits,String(row.id),"INTERNAL_TRANSFER_CREDIT",input.amountCents);
    const sourceEntries=input.asaasFunding.walletReturns.flatMap(c=>[c.proof.originalHostDebit.id,c.proof.originalSellerCredit.id,c.proof.sellerReturnDebit.id,c.proof.hostReturnCredit.id]);
    if (debit.id===credit.id||sourceEntries.includes(debit.id)||sourceEntries.includes(credit.id)) return {state:"unknown"};
    const latest=await this.json(context.host,`/transfers/${encodeURIComponent(String(row.id))}`);
    this.transfer(latest,input.reference,input.destination,input.amountCents);
    const sellerAccount=input.asaasFunding.destinationAccounts.find(a=>a.merchantId===input.beneficiaryMerchantId)!;
    const asaasProof:AsaasMarketplaceResidualTransferProof={version:5,kind:"residual_payout",association:"local_immutable_residual_journal",
      requestHash:input.requestHash,reference:input.reference,providerTransferId:base.providerTransferId,
      hostAccountFingerprint:input.accountFingerprint,sellerAccountFingerprint:sellerAccount.accountFingerprint,
      hostWalletId:input.asaasFunding.host.walletId,sellerWalletId:input.destination,amountCents:input.amountCents,
      observedAt:base.observedAt,hostDebit:debit,sellerCredit:credit};
    return this.identity(latest)===this.identity(row)?{state:"confirmed",...base,asaasProof}:{state:"unknown"};
  }
  private entry(rows:Json[],transferId:string,type:AsaasMarketplaceWalletReturnLedgerReceipt["type"],amount:number):AsaasMarketplaceWalletReturnLedgerReceipt {
    const row=rows[0];
    if (rows.length!==1||!row||row.object!=="financialTransaction"||!identifier(row.id)||row.transferId!==transferId||row.type!==type||
      money(row.value)!==amount||!date(row.date)||!absent(row.paymentId)||!absent(row.splitId)||!absent(row.billId)||!absent(row.anticipationId)) return fail();
    return {id:row.id,transferId,type,amountCents:amount,date:row.date as string};
  }
  private async retentionProof(input:Request,fresh:boolean):Promise<AsaasMarketplaceHostRetentionProof|undefined> {
    if(input.version!==7)return;
    if(!this.retention||!this.retentionVerifier)fail();const c=await this.retention!.read(input.hostRetention);
    if(!c||c.journalId!==input.hostRetention.journalId||c.request.requestHash!==input.hostRetention.requestHash||
      c.certificateHash!==asaasResidualHash({request:c.request,proof:c.proof})||!validAsaasMarketplaceHostRetentionProof(c.request,c.proof)||
      asaasResidualHash(buildAsaasMarketplaceHostRetentionOutboundRequest({retention:c.request,beneficiaryMerchantId:input.beneficiaryMerchantId}))!==asaasResidualHash(input))fail();
    if(fresh) {
      const seen=await this.retentionVerifier!.certify(c.request);
      if(seen.state!=='certified'||!validAsaasMarketplaceHostRetentionProof(c.request,seen.proof,this.now()))fail();
      const {observedAt:_old,...old}=c.proof,{observedAt:_fresh,...current}=seen.proof;
      if(asaasResidualHash(old)!==asaasResidualHash(current))fail();
      return seen.proof;
    }
    return c.proof;
  }
  async submit(original:Request) {
    let admissionAttempted=false,postAttempted=false;
    try {
      const input=structuredClone(original);this.validate(input);
      if (!this.authorization||!this.accounts||!this.walletReturns) return {state:"not_submitted" as const};
      const authorization=await this.authorization.read(input.requestHash);
      if (!authorization||authorization.requestHash!==input.requestHash||!identifier(authorization.operationId)) return {state:"not_submitted" as const};
      if (authorization.state!=="claimed"||authorization.providerTransferId) return {state:"unknown" as const};
      const context=await this.context(input);await this.wallets(input,context);
      const before=await this.payment(input);await this.sourceProof(input);
      if ((await this.transfers(input)).some(r=>r.externalReference===input.reference)) return {state:"unknown" as const};
      await this.wallets(input,context);if (before!==await this.payment(input)) fail();const retentionPreflight=await this.retentionProof(input,true);
      admissionAttempted=true;const permit=await this.authorization.consumeSubmissionAuthorization(input.requestHash,
        input.version===7?{hostRetentionProof:retentionPreflight!}:undefined);
      if (!permit||permit.state!=="submission_authorized"||permit.requestHash!==input.requestHash||permit.operationId!==authorization.operationId) return {state:"unknown" as const};
      postAttempted=true;
      const row=await this.json(context.host,"/transfers/",{method:"POST",body:JSON.stringify({value:input.amountCents/100,walletId:input.destination,externalReference:input.reference})});
      if (!identifier(row.id)||row.externalReference!==input.reference||row.walletId!==input.destination||money(row.value)!==input.amountCents) return {state:"unknown" as const};
      // Creation responses, including DONE/FAILED, are never terminal evidence.
      return {state:"pending" as const,providerTransferId:row.id,amountCents:input.amountCents,observedAt:this.now().toISOString()};
    } catch {return {state:admissionAttempted||postAttempted?"unknown" as const:"not_submitted" as const};}
  }
  async reconcile(original:Request,providerTransferId?:string):Promise<MarketplaceResidualObservation> {
    try {
      const input=structuredClone(original);this.validate(input);
      if (!this.authorization||providerTransferId!==undefined&&!identifier(providerTransferId)) return {state:"unknown"};
      const authorization=await this.authorization.read(input.requestHash);
      if (!authorization||authorization.requestHash!==input.requestHash||authorization.state!=="submitted"||
        providerTransferId&&authorization.providerTransferId&&providerTransferId!==authorization.providerTransferId) return {state:"unknown"};
      await this.retentionProof(input,false);const context=await this.context(input);await this.wallets(input,context);
      const rows=await this.transfers(input),found=rows.filter(r=>r.externalReference===input.reference),
        expectedId=providerTransferId??authorization.providerTransferId;
      if (found.length!==1||expectedId&&found[0]!.id!==expectedId) return {state:"unknown"};
      const row=await this.json(context.host,`/transfers/${encodeURIComponent(String(found[0]!.id))}`);
      if (row.id!==found[0]!.id||this.identity(row)!==this.identity(found[0]!)) return {state:"unknown"};
      const observation=await this.receipt(input,context,row);
      if (observation.state==="confirmed") {
        try {const before=await this.payment(input);await this.sourceProof(input);await this.wallets(input,context);
          if (before!==await this.payment(input)) fail();await this.retentionProof(input,true);}
        catch {return {...observation,reconciliationRequired:true};}
      }
      return observation;
    } catch {return {state:"unknown"};}
  }
  private async list(account:Account,path:string):Promise<Json[]> {
    const rows:Json[]=[],seen=new Set<string>();let offset=0,total:number|undefined;
    for(let page=0;page<20;page++) {
      const result=await this.json(account,`${path}&limit=100&offset=${offset}`);
      if(result.object!=="list"||typeof result.hasMore!=="boolean"||!Number.isSafeInteger(result.totalCount)||Number(result.totalCount)<0||
        result.offset!==offset||!Number.isSafeInteger(result.limit)||Number(result.limit)<1||Number(result.limit)>100||
        !Array.isArray(result.data)||result.data.length>Number(result.limit)||total!==undefined&&total!==result.totalCount) fail();
      total=Number(result.totalCount);
      for(const row of result.data) {if(!object(row)||!identifier(row.id)||seen.has(row.id))fail();seen.add(row.id);rows.push(row);}
      if(!result.hasMore){if(rows.length!==total)fail();return rows;}
      if(!result.data.length||rows.length>=total!)fail();offset+=result.data.length;
    }
    return fail();
  }
  private async json(account:Account,path:string,init:RequestInit={}):Promise<Json> {
    const response=await this.request(`${new URL(account.asaasOrigin!).origin}/v3${path}`,{...init,
      headers:{access_token:account.asaasKey!,accept:"application/json","content-type":"application/json","user-agent":"ZyonMarketplace/1.0"},
      redirect:"error",signal:AbortSignal.timeout(15000)});
    if(!response.ok)fail();const body:unknown=await response.json();if(!object(body))fail();return body as Json;
  }
}
