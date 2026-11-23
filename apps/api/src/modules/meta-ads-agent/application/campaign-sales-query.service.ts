import type {MetaAdsAttributedOrder,MetaAdsCampaign,MetaAdsCampaignSalesPage,MetaAdsOrderAdOrigin,MetaAdsPurchaseSignalStatus} from '@zyon/shared-types';
import {MetaAdsError,type AttributedPurchase,type Clock,type CommerceContextPort,type MetaAdsRepository,type MetaAdsStoreState,type PaidOrderFact} from '../domain/types.js';
import {requireIdentifier} from '../domain/offer.js';
import {observationPeriod} from '../domain/daily-observation-calendar.js';
interface Dependencies {repo:Pick<MetaAdsRepository,'read'>;commerce:Pick<CommerceContextPort,'paidOrder'|'paidOrders'>;timezone(merchantId:string,campaign?:MetaAdsCampaign):Promise<string>;clock?:Clock}
const signal=(purchase:AttributedPurchase|undefined):MetaAdsPurchaseSignalStatus=>purchase?.signalStatus==='sent'?'accepted':purchase?.signalStatus==='sending'?'pending':purchase?.signalStatus??'not_authorized';
const counts=():Record<MetaAdsPurchaseSignalStatus,number>=>({not_authorized:0,pending:0,accepted:0,failed:0,unknown:0});
const validFact=(f:PaidOrderFact,m:string)=>f.merchantId===m&&Number.isSafeInteger(f.paidCents)&&f.paidCents>=0&&Number.isSafeInteger(f.refundedCents)&&f.refundedCents>=0&&f.refundedCents<=f.paidCents&&Number.isFinite(Date.parse(f.paidAt));
export class CampaignSalesQueryService {
 private readonly clock:Clock;
 constructor(private readonly deps:Dependencies){this.clock=deps.clock??(()=>new Date());}
 private origin(state:MetaAdsStoreState,fact:PaidOrderFact):MetaAdsOrderAdOrigin{
  const p=state.purchases?.[fact.orderId],campaign=p?.campaignId&&Object.hasOwn(state.campaigns,p.campaignId)?state.campaigns[p.campaignId]:null;
  const status=!fact.paid?'unpaid':!p?'unavailable':p.campaignId&&!campaign?'unavailable':campaign?'identified':'unidentified';
  return{orderId:fact.orderId,status,rule:p?.attribution?.rule??'legacy',campaignId:status==='identified'?campaign!.id:null,campaignName:status==='identified'?campaign!.draft.name:null,source:status==='identified'?p!.source:null,observedAt:p?.attribution?.observedAt??null,paidAt:fact.paid?fact.paidAt:null,frozenAt:p?.attribution?.frozenAt??p?.reconciledAt??null,signalStatus:signal(p)};
 }
 private unavailableOrigin(orderId:string):MetaAdsOrderAdOrigin{return{orderId,status:'unavailable',rule:'legacy',campaignId:null,campaignName:null,source:null,observedAt:null,paidAt:null,frozenAt:null,signalStatus:'unknown'};}
 async orderOrigin(merchantId:string,orderId:string):Promise<MetaAdsOrderAdOrigin>{
  requireIdentifier(merchantId);if(typeof orderId!=='string'||!orderId||orderId.length>200||/[\x00-\x1f]/.test(orderId))throw new MetaAdsError('order_id_invalid');
  let fact:PaidOrderFact|null,state:MetaAdsStoreState;try{[fact,state]=await Promise.all([this.deps.commerce.paidOrder(merchantId,orderId),this.deps.repo.read(merchantId)]);}catch{return this.unavailableOrigin(orderId);}
  if(!fact||fact.merchantId!==merchantId)throw new MetaAdsError('order_not_found',404);
  return validFact(fact,merchantId)?this.origin(state,fact):this.unavailableOrigin(fact.orderId);
 }
 private query(input:Record<string,unknown>){
  if(Object.keys(input).some(k=>!['since','until','page'].includes(k)))throw new MetaAdsError('request_fields_invalid');
  const {since,until}=input,page=typeof input.page==='string'&&/^\d+$/.test(input.page)?Number(input.page):input.page??1;
  if(typeof since!=='string'||typeof until!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(since)||!/^\d{4}-\d{2}-\d{2}$/.test(until)||!Number.isFinite(Date.parse(since))||!Number.isFinite(Date.parse(until))||new Date(since).toISOString().slice(0,10)!==since||new Date(until).toISOString().slice(0,10)!==until||until<since||Date.parse(until)-Date.parse(since)>365*86400000)throw new MetaAdsError('metrics_period_invalid');
  if(typeof page!=='number'||!Number.isSafeInteger(page)||page<1)throw new MetaAdsError('invalid_page_size');return{since,until,page};
 }
 async sales(merchantId:string,campaignId:string,input:Record<string,unknown>):Promise<MetaAdsCampaignSalesPage>{
  requireIdentifier(merchantId);requireIdentifier(campaignId);const query=this.query(input),state=await this.deps.repo.read(merchantId),campaign=Object.hasOwn(state.campaigns,campaignId)?state.campaigns[campaignId]:null;
  if(!campaign||campaign.lifecycle?.state==='deleted_draft')throw new MetaAdsError('campaign_not_found',404);
  let timezone:string|null=null;
  const unavailable=():MetaAdsCampaignSalesPage=>({campaignId,...query,timezone,currency:null,status:'unavailable',paidOrders:null,confirmedRevenueCents:null,refundedCents:null,orders:[],pageSize:10,pages:1,updatedAt:this.clock().toISOString(),signalCounts:null});
  try{
   timezone=await this.deps.timezone(merchantId,campaign);const start=observationPeriod(query.since,timezone).startsAt,end=observationPeriod(query.until,timezone).endsAt;
   const facts=await this.deps.commerce.paidOrders(merchantId,start,end);if(facts.some(f=>!validFact(f,merchantId)))return unavailable();
   const paid=[...new Map(facts.filter(f=>f.paid&&Date.parse(f.paidAt)>=Date.parse(start)&&Date.parse(f.paidAt)<Date.parse(end)).map(f=>[f.orderId,f])).values()];
   if(paid.some(f=>f.currency!=='BRL'||!state.purchases?.[f.orderId]))return unavailable();
   const selected=paid.filter(f=>state.purchases![f.orderId].campaignId===campaignId).sort((a,b)=>b.paidAt.localeCompare(a.paidAt)||a.orderId.localeCompare(b.orderId));
   const signalCounts=counts(),orders:MetaAdsAttributedOrder[]=selected.map(f=>{const origin=this.origin(state,f);signalCounts[origin.signalStatus]++;return{orderId:f.orderId,paidAt:f.paidAt,currency:f.currency,paidCents:f.paidCents,refundedCents:f.refundedCents,netRevenueCents:f.paidCents-f.refundedCents,origin};});
   const pages=Math.max(1,Math.ceil(orders.length/10)),page=Math.min(query.page,pages);
   return{campaignId,since:query.since,until:query.until,timezone,currency:'BRL',status:'available',paidOrders:orders.length,confirmedRevenueCents:orders.reduce((sum,o)=>sum+o.netRevenueCents,0),refundedCents:orders.reduce((sum,o)=>sum+o.refundedCents,0),orders:orders.slice((page-1)*10,page*10),page,pageSize:10,pages,updatedAt:this.clock().toISOString(),signalCounts};
  }catch{return unavailable();}
 }
}
