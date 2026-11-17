import type {MetaAdsDailyReport,MetaAdsMetrics} from '@zyon/shared-types';

const sumKeys=['spendCents','attributedRevenueCents','confirmedRevenueCents','paidOrders','conversations','contributionCents'] as const;
type SumKey=typeof sumKeys[number];
export type AdsTotals=Record<SumKey|'costPerPurchaseCents'|'roas',number|null>;
export interface AdsPoint {day:string;spendCents:number|null;attributedRevenueCents:number|null;paidOrders:number|null;conversations:number|null;}
export interface AdsDashboardData {
  since:string|null;until:string|null;timezone:string|null;currency:string|null;updatedAt:string|null;
  totals:AdsTotals;partialMetrics:Array<keyof AdsTotals>;partial:boolean;hasData:boolean;daysWithData:number;totalDays:number;
  points:AdsPoint[];campaigns:Array<{id:string;totals:AdsTotals;partial:boolean}>;
}
interface Selection {accountId:string|null;days:1|7|30;campaignId?:string;throughDay?:string;}
type Observation=MetaAdsMetrics|null;
const shift=(day:string,offset:number)=>{const date=new Date(day+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+offset);return date.toISOString().slice(0,10);};
const observed=(row:Observation):row is MetaAdsMetrics=>!!row&&!row.stale;

function consolidate(rows:Observation[],missingDays:boolean) {
  const usable=rows.filter(observed),currencies=new Set(usable.map(row=>row.currency));
  const currency=currencies.size===1?[...currencies][0]:null;
  const totals={} as AdsTotals,partialMetrics:Array<keyof AdsTotals>=[];
  for(const key of sumKeys){
    const values=usable.map(row=>row[key]).filter((value):value is number=>value!==null);
    const monetary=key.endsWith('Cents');
    totals[key]=values.length&&(!monetary||currency)?values.reduce((sum,value)=>sum+value,0):null;
    if(missingDays||values.length!==rows.length||!values.length||monetary&&!currency)partialMetrics.push(key);
  }
  const complete=!missingDays&&usable.length===rows.length&&usable.length>0&&!!currency;
  const spend=totals.spendCents,revenue=totals.attributedRevenueCents,orders=totals.paidOrders;
  const matching=complete&&usable.every(row=>!row.notes.includes('currency_mismatch'));
  totals.roas=matching&&!partialMetrics.includes('spendCents')&&!partialMetrics.includes('attributedRevenueCents')&&spend!==null&&spend>0&&revenue!==null?revenue/spend:null;
  totals.costPerPurchaseCents=matching&&!partialMetrics.includes('spendCents')&&!partialMetrics.includes('paidOrders')&&usable.every(row=>row.confirmedRevenueCents!==null)&&spend!==null&&orders!==null&&orders>0?Math.round(spend/orders):null;
  if(totals.roas===null)partialMetrics.push('roas');
  if(totals.costPerPurchaseCents===null)partialMetrics.push('costPerPurchaseCents');
  return {totals,currency,partialMetrics};
}

/** The input is closed-day data. Gaps are retained; ratios never average ratios. */
export function buildAdsDashboard(reports:MetaAdsDailyReport[],selection:Selection):AdsDashboardData {
  const account=reports.filter(report=>selection.accountId!==null&&report.accountId===selection.accountId&&(!selection.throughDay||report.localDay<=selection.throughDay));
  const latest=account.sort((a,b)=>b.localDay.localeCompare(a.localDay)||b.updatedAt.localeCompare(a.updatedAt))[0];
  const until=selection.throughDay??latest?.localDay??null,since=until?shift(until,1-selection.days):null,timezone=latest?.timezone??null;
  const byDay=new Map<string,MetaAdsDailyReport>();
  for(const report of account){
    if(!since||!until||report.localDay<since||report.localDay>until||report.timezone!==timezone)continue;
    const previous=byDay.get(report.localDay);
    if(!previous||report.updatedAt>previous.updatedAt)byDay.set(report.localDay,report);
  }
  const days=until?Array.from({length:selection.days},(_,index)=>{
    const day=shift(until,index+1-selection.days),report=byDay.get(day);
    const campaigns=report?.campaigns.filter(row=>!selection.campaignId||row.campaignId===selection.campaignId)??[];
    return {day,report,campaigns,rows:campaigns.map(row=>row.metrics)};
  }):[];
  const rows=days.flatMap(day=>day.rows),daysWithData=days.filter(day=>day.rows.some(observed)).length;
  const missingDays=daysWithData<selection.days;
  const summary=consolidate(rows,missingDays),ids=[...new Set(days.flatMap(day=>day.campaigns.map(row=>row.campaignId)))].sort();
  const partial=missingDays||rows.some(row=>!observed(row))||days.some(day=>day.report?.status==='partial')||(!summary.currency&&rows.some(observed));
  const points=days.map(day=>{
    const item=consolidate(day.rows,false);
    const value=(key:SumKey)=>item.partialMetrics.includes(key)||key.endsWith('Cents')&&(!summary.currency||item.currency!==summary.currency)?null:item.totals[key];
    return {day:day.day,spendCents:value('spendCents'),attributedRevenueCents:value('attributedRevenueCents'),paidOrders:value('paidOrders'),conversations:value('conversations')};
  });
  return {since,until,timezone,currency:summary.currency,updatedAt:[...byDay.values()].map(report=>report.updatedAt).sort().at(-1)??null,
    totals:summary.totals,partialMetrics:summary.partialMetrics,partial,hasData:rows.some(observed),daysWithData,totalDays:selection.days,points,
    campaigns:ids.map(id=>{
      const campaignRows=days.flatMap(day=>day.campaigns.filter(row=>row.campaignId===id).map(row=>row.metrics));
      const missing=days.some(day=>!day.campaigns.some(row=>row.campaignId===id&&observed(row.metrics)));
      return {id,totals:consolidate(campaignRows,missing).totals,partial:missing||campaignRows.some(row=>!observed(row))};
    })};
}
