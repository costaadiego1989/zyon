import type {PrismaClient} from '@prisma/client';
import {assertPaymentAmount,orderTotalCents,type PaymentAmountBreakdown} from '../../payment/domain/payment-amount.js';
import {MetaAdsError,type CommerceContextPort,type MetaAdsRepository,type ProductOpportunityFact,type ProductOpportunityReader} from '../domain/types.js';
import {requireIdentifier} from '../domain/offer.js';

interface Row {id:string;order_total:string;currency:string;completed_at:Date;line_items_json:unknown;payment_status:string;amount_cents:number|null;approved_amount_cents:number|null;amount_breakdown:PaymentAmountBreakdown|null;status_history:Array<{status:string;occurredAt:string}>|null;refunded_cents:bigint}
interface Dependencies {db:Pick<PrismaClient,'$queryRaw'>;commerce:Pick<CommerceContextPort,'products'>;repo:Pick<MetaAdsRepository,'read'>}

/** Aggregate immutable checkout snapshots in batches, never query each product's orders. */
export class ProductOpportunityFactsReader implements ProductOpportunityReader {
 constructor(private readonly deps:Dependencies){}
 async read(merchantId:string,variantIds:string[],since:string,until:string):Promise<ProductOpportunityFact[]>{
  requireIdentifier(merchantId);
  if(!Array.isArray(variantIds)||!variantIds.length||variantIds.length>30||new Set(variantIds).size!==variantIds.length)throw new MetaAdsError('opportunity_candidates_invalid');
  variantIds.forEach(requireIdentifier);const start=new Date(since),end=new Date(until);
  if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<=start||end.getTime()-start.getTime()>366*86400000)throw new MetaAdsError('metrics_period_invalid');
  const [products,state]=await Promise.all([this.deps.commerce.products(merchantId,{variantIds}),this.deps.repo.read(merchantId)]);
  if(products.some(p=>!variantIds.includes(p.variantId)))throw new MetaAdsError('catalog_tenant_mismatch',403);
  const facts=new Map(products.map(product=>[product.variantId,{product,since,until,paidUnits:0,netRevenueCents:0,adSpendCents:null,adPaidOrders:null,historicalCostCents:null,costCoverage:'unavailable'} as ProductOpportunityFact]));
  let cursor='';
  while(true){
   const rows=await this.deps.db.$queryRaw<Row[]>`SELECT o.id,o.order_total::text,o.currency,o.completed_at,o.line_items_json,p.status AS payment_status,p.amount_cents,p.approved_amount_cents,p.amount_breakdown,p.status_history,
    (SELECT COALESCE(SUM(rf.amount_in_cents),0) FROM returns r JOIN return_refunds rf ON rf.return_id=r.id WHERE r.merchant_id=${merchantId} AND (r.order_id=o.id OR r.order_id=o.external_order_id) AND rf.status='COMPLETED') AS refunded_cents
    FROM completed_orders o JOIN LATERAL (SELECT * FROM payment_intents pi WHERE pi.merchant_id=${merchantId} AND pi.session_id=o.session_id AND pi.currency=o.currency AND pi.status IN ('approved','refunded','chargeback_won') ORDER BY pi.updated_at DESC,pi.id DESC LIMIT 1) p ON true
    LEFT JOIN LATERAL (SELECT item->>'occurredAt' AS approved_at FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.status_history)='array' THEN p.status_history ELSE '[]'::jsonb END) item WHERE item->>'status'='approved' LIMIT 1) h ON true
    WHERE o.merchant_id=${merchantId} AND o.id>${cursor}
    AND (CASE WHEN pg_input_is_valid(h.approved_at,'timestamp with time zone') THEN h.approved_at::timestamptz ELSE o.completed_at AT TIME ZONE 'UTC' END)>=${start}
    AND (CASE WHEN pg_input_is_valid(h.approved_at,'timestamp with time zone') THEN h.approved_at::timestamptz ELSE o.completed_at AT TIME ZONE 'UTC' END)<${end}
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o.line_items_json)='array' THEN o.line_items_json ELSE '[]'::jsonb END) item WHERE item->>'variantId'=ANY(${variantIds}::text[])) ORDER BY o.id LIMIT 250`;
   for(const row of rows){
    const approvedAt=row.status_history?.find(e=>e.status==='approved')?.occurredAt,paidAt=approvedAt&&Number.isFinite(Date.parse(approvedAt))?Date.parse(approvedAt):row.completed_at.getTime();
    if(row.currency!=='BRL'||paidAt<start.getTime()||paidAt>=end.getTime())continue;
    const amount=Math.round(Number(row.order_total)*100),approved=row.approved_amount_cents??row.amount_cents??0;
    if(!Number.isSafeInteger(amount)||amount<0)throw new MetaAdsError('purchase_amount_unreconciled',409);
    if(row.amount_breakdown){assertPaymentAmount(row.amount_breakdown,approved,row.currency);if(orderTotalCents(row.amount_breakdown,approved)!==amount)throw new MetaAdsError('purchase_amount_unreconciled',409);}else if(approved<amount)throw new MetaAdsError('purchase_amount_unreconciled',409);
    const refunded=row.payment_status==='refunded'?amount:Math.min(amount,Number(row.refunded_cents??0)),net=amount-refunded;if(net<=0)continue;
    const lines=row.line_items_json as Array<{variantId?:string;quantity?:number}>;
    if(!Array.isArray(lines)||lines.some(l=>!l||typeof l.variantId!=='string'||!Number.isSafeInteger(l.quantity)||l.quantity!<=0))throw new MetaAdsError('purchase_items_unreconciled',409);
    const variants=new Set(lines.map(l=>l.variantId));
    for(const variantId of variants){const fact=facts.get(variantId!);if(!fact)continue;fact.paidUnits!+=lines.filter(l=>l.variantId===variantId).reduce((sum,l)=>sum+l.quantity!,0);fact.netRevenueCents=variants.size===1&&fact.netRevenueCents!==null?fact.netRevenueCents+net:null;}
   }
   if(rows.length<250)break;cursor=rows.at(-1)!.id;
  }
  for(const fact of facts.values()){
   const metrics=Object.values(state.campaigns).filter(c=>c.draft.variantIds.length===1&&c.draft.variantIds[0]===fact.product.variantId&&c.remoteAccountId===state.connection.account?.id).map(c=>state.metrics[c.id]).filter(m=>m&&!m.stale&&m.currency==='BRL'&&m.since===since.slice(0,10)&&m.until===new Date(end.getTime()-1).toISOString().slice(0,10));
   if(metrics.length&&metrics.every(m=>m.spendCents!==null))fact.adSpendCents=metrics.reduce((sum,m)=>sum+m.spendCents!,0);
   if(metrics.length&&metrics.every(m=>m.confirmedOrdersStatus==='available'))fact.adPaidOrders=metrics.reduce((sum,m)=>sum+m.paidOrders,0);
  }
  return variantIds.flatMap(id=>facts.has(id)?[facts.get(id)!]:[]);
 }
}
