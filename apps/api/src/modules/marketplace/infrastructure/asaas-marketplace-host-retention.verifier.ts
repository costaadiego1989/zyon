import type {AsaasMarketplaceHostRetentionRequest,AsaasMarketplaceHostRetentionProof,AsaasMarketplaceHostRetentionVerifier,
  AsaasMarketplaceHostRetentionLedgerReceipt} from '../domain/ports/asaas-marketplace-host-retention.port.js';
import type {AsaasMarketplaceResidualAccountReader,AsaasMarketplaceResidualWalletReturnVerifier} from '../domain/ports/asaas-marketplace-residual.port.js';
import {validAsaasMarketplaceHostRetentionRequest,validAsaasMarketplaceHostRetentionProof,asaasHostRetentionDate} from '../domain/services/asaas-marketplace-host-retention.js';
import {asaasResidualHash,validAsaasResidualCertificate} from '../domain/services/asaas-marketplace-residual.js';
import {marketplaceCaptureAccount} from './marketplace-capture-account.js';
import {asaasMarketplaceRefundReceiptId} from './asaas-marketplace-refund.adapter.js';
type Json=Record<string,unknown>;
type Account={asaasKey?:string;asaasOrigin?:string};
const object=(v:unknown):v is Json=>!!v&&typeof v==='object'&&!Array.isArray(v);
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
function fail():never {throw Error('marketplace_asaas_host_retention_native_unproven');}
function money(v:unknown):number {if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>21474836.47)fail();const c=Math.round(v*100);if(Math.abs(v*100-c)>0.000001)fail();return c;}
const absent=(v:unknown)=>v===undefined||v===null;

/** Accounting certification of already received principal. It neither
 * reserves funds at Asaas nor creates a self-transfer or synthetic receipt. */
export class AsaasMarketplaceHostRetentionNativeVerifier implements AsaasMarketplaceHostRetentionVerifier {
  constructor(private readonly accounts:AsaasMarketplaceResidualAccountReader,
    private readonly walletReturns:AsaasMarketplaceResidualWalletReturnVerifier,
    private readonly request:typeof fetch=globalThis.fetch,private readonly now:()=>Date=()=>new Date()){}
  private async json(account:Account,path:string):Promise<Json> {
    if(!account.asaasKey||!account.asaasOrigin)fail();
    const response=await this.request(new URL(account.asaasOrigin).origin+'/v3'+path,{method:'GET',headers:{access_token:account.asaasKey},signal:AbortSignal.timeout(10000)});
    if(!response.ok)fail();const body:unknown=await response.json();if(!object(body))fail();return body;
  }
  private async wallet(account:Account,r:AsaasMarketplaceHostRetentionRequest):Promise<void> {
    const w=await this.json(account,'/wallets/');
    if(w.object!=='list'||w.hasMore!==false||w.totalCount!==1||!Array.isArray(w.data)||w.data.length!==1||
      !object(w.data[0])||w.data[0].object!=='wallet'||w.data[0].id!==r.host.walletId)fail();
  }
  private async payment(account:Account,r:AsaasMarketplaceHostRetentionRequest):Promise<{created:string;hash:string}> {
    const p=await this.json(account,`/payments/${r.capture.providerPaymentId}`),billing=r.paymentMethod==='pix'?'PIX':'CREDIT_CARD';
    if(p.id!==r.capture.providerPaymentId||p.status!=='RECEIVED'||p.billingType!==billing||money(p.value)!==r.capture.amountCents||
      !asaasHostRetentionDate(p.dateCreated)||p.deleted===true||p.anticipated===true||!absent(p.chargeback)||
      !absent(p.installment)||!absent(p.subscription)||!absent(p.receivableAnticipation)||
      !Array.isArray(p.split)||p.split.length||!Array.isArray(p.refunds)||p.refunds.length!==r.basis.refunds.length||
      money(p.refundedValue)!==r.allocation.refundedCents)fail();
    const created=p.dateCreated;
    const refunds=p.refunds.map(v=>{
      if(!object(v)||v.status!=='DONE'||!Array.isArray(v.refundedSplits)||v.refundedSplits.length||typeof v.description!=='string'||!v.description||
        typeof v.dateCreated!=='string'||!/^\d{4}-\d{2}-\d{2}[ T](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(v.dateCreated)||
        !asaasHostRetentionDate(v.dateCreated.slice(0,10))||v.dateCreated.slice(0,10)<created)fail();
      const amountCents=money(v.value),providerOperationId=asaasMarketplaceRefundReceiptId(r.capture,{description:v.description,dateCreated:v.dateCreated,value:amountCents/100});
      if(!r.basis.refunds.some(f=>f.providerOperationId===providerOperationId&&f.amountCents===amountCents))fail();
      return {providerOperationId,amountCents,dateCreated:v.dateCreated};
    });
    if(new Set(refunds.map(v=>v.providerOperationId)).size!==refunds.length)fail();
    return {created:p.dateCreated,hash:asaasResidualHash({id:p.id,status:p.status,billingType:p.billingType,value:p.value,dateCreated:p.dateCreated,refunds:refunds.sort((a,b)=>a.providerOperationId.localeCompare(b.providerOperationId))})};
  }
  private async ledger(account:Account,r:AsaasMarketplaceHostRetentionRequest,start:string,end:string):Promise<AsaasMarketplaceHostRetentionLedgerReceipt[]> {
    const entries:AsaasMarketplaceHostRetentionLedgerReceipt[]=[],ids=new Set<string>();let total:number|undefined;
    for(let offset=0,page=0;page<200;page++) {
      const response=await this.json(account,`/financialTransactions?offset=${offset}&limit=100&startDate=${start}&finishDate=${end}&order=asc`);
      if(response.object!=='list'||response.offset!==offset||response.limit!==100||typeof response.hasMore!=='boolean'||
        !Number.isSafeInteger(response.totalCount)||Number(response.totalCount)<0||Number(response.totalCount)>20000||
        total!==undefined&&response.totalCount!==total||!Array.isArray(response.data)||response.data.length>100)fail();
      total=Number(response.totalCount);
      for(const v of response.data) {
        if(!object(v)||!id(v.id)||ids.has(v.id))fail();ids.add(v.id);
        if(['PAYMENT_RECEIVED','PAYMENT_FEE','PAYMENT_REVERSAL'].includes(String(v.type))&&absent(v.paymentId))fail();
        if(v.paymentId!==r.capture.providerPaymentId)continue;
        if(v.object!=='financialTransaction'||!['PAYMENT_RECEIVED','PAYMENT_FEE','PAYMENT_REVERSAL'].includes(String(v.type))||
          !asaasHostRetentionDate(v.date)||v.date<start||v.date>end||!absent(v.splitId)||!absent(v.anticipationId)||!absent(v.transferId))fail();
        entries.push({id:v.id,paymentId:r.capture.providerPaymentId,type:v.type as AsaasMarketplaceHostRetentionLedgerReceipt['type'],amountCents:money(v.value),date:v.date});
      }
      offset+=response.data.length;
      if(!response.hasMore){if(offset!==total)fail();return entries.sort((a,b)=>a.id.localeCompare(b.id));}
      if(!response.data.length||offset>=total)fail();
    }
    return fail();
  }
  async certify(r:AsaasMarketplaceHostRetentionRequest):Promise<{state:'certified';proof:AsaasMarketplaceHostRetentionProof}|{state:'unproven'}> {
    try {
      if(!validAsaasMarketplaceHostRetentionRequest(r))fail();
      const account=await this.accounts.read(r.host);
      if(!account||marketplaceCaptureAccount('asaas',r.capture.environment,account.asaasKey,account.asaasOrigin).accountFingerprint!==r.host.accountFingerprint)fail();
      await this.wallet(account,r);const payment=await this.payment(account,r);
      for(const c of r.basis.asaasFunding.walletReturns) {
        if(!validAsaasResidualCertificate(c))fail();
        const seen=await this.walletReturns.reconcile(c.request,c.providerTransferId);
        if(seen.state!=='returned'||seen.amountCents!==c.amountCents||seen.providerTransferId!==c.providerTransferId||!seen.proof)fail();
        const {observedAt:_old,...expected}=c.proof,{observedAt:_fresh,...actual}=seen.proof;
        if(asaasResidualHash(actual)!==asaasResidualHash(expected))fail();
      }
      const end=this.now().toISOString().slice(0,10),entries=await this.ledger(account,r,payment.created,end);
      const credits=entries.filter(e=>e.type==='PAYMENT_RECEIVED');if(credits.length!==1)fail();
      await this.wallet(account,r);const freshPayment=await this.payment(account,r);
      const freshEntries=await this.ledger(account,r,payment.created,end);
      if(payment.hash!==freshPayment.hash||asaasResidualHash(entries)!==asaasResidualHash(freshEntries))fail();
      const proof:AsaasMarketplaceHostRetentionProof={version:7,kind:'host_principal_retention',association:'local_immutable_host_retention_journal',
        requestHash:r.requestHash,providerPaymentId:r.capture.providerPaymentId,hostAccountFingerprint:r.host.accountFingerprint,hostWalletId:r.host.walletId,
        amountCents:r.amountCents,capturedGrossCents:r.capture.amountCents,processingFeeCents:r.capture.providerFeeCents,refundedCents:r.allocation.refundedCents,
        paymentCreatedDate:payment.created,observedAt:this.now().toISOString(),captureCredit:credits[0]!,
        processingFees:entries.filter(e=>e.type==='PAYMENT_FEE'),buyerRefundDebits:entries.filter(e=>e.type==='PAYMENT_REVERSAL')};
      if(!validAsaasMarketplaceHostRetentionProof(r,proof,this.now()))fail();return {state:'certified',proof};
    }catch{return {state:'unproven'};}
  }
}
