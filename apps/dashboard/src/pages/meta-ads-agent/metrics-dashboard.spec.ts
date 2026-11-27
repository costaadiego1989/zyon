import {expect,test} from 'vitest';
import type {MetaAdsDailyReport,MetaAdsMetrics} from '@zyon/shared-types';
import {buildAdsDashboard} from './metrics-dashboard.js';

const metric=(campaignId='c1',patch:Partial<MetaAdsMetrics>={}):MetaAdsMetrics=>({campaignId,since:'2026-11-16',until:'2026-11-16',timezone:'America/Sao_Paulo',updatedAt:'2026-11-17T03:01:00Z',currency:'BRL',attributionWindow:'7d_click,1d_view',source:'meta_reported+zyon_reconciled',spendCents:2000,attributedRevenueCents:8000,confirmedRevenueCents:5000,paidOrders:2,conversations:3,costPerPurchaseCents:1000,roas:4,contributionCents:1000,costCoverage:'complete',stale:false,notes:[],...patch});
const report=(day:string,metrics:Array<MetaAdsMetrics|null>,patch:Partial<MetaAdsDailyReport>={}):MetaAdsDailyReport=>({id:'report-'+day,accountId:'100',localDay:day,timezone:'America/Sao_Paulo',since:day,until:day,updatedAt:'2026-11-17T03:01:00Z',collectedAt:'2026-11-17T03:01:00Z',status:'completed',analysisStatus:'completed',campaigns:metrics.map((m,i)=>({campaignId:m?.campaignId??'missing-'+i,metrics:m,status:m?'available':'unavailable',missing:[],recommendations:[],actions:[]})),notes:[],...patch});
const data=()=>[report('2026-11-16',[metric(),metric('c2',{spendCents:1000,attributedRevenueCents:5000,confirmedRevenueCents:3000,paidOrders:1,conversations:2,contributionCents:500})]),report('2026-11-15',[metric('c1',{spendCents:1000,attributedRevenueCents:2000,confirmedRevenueCents:1000,paidOrders:1,conversations:1,contributionCents:-200})])];

test('ADAS-67 canonical account totals and ratios use observations rather than averaging campaign ROAS',()=>{
  const result=buildAdsDashboard(data(),{accountId:'100',days:1});
  expect(result.totals).toEqual({spendCents:3000,attributedRevenueCents:13000,confirmedRevenueCents:8000,paidOrders:3,conversations:5,contributionCents:1500,costPerPurchaseCents:1000,roas:13000/3000});
  expect(result.currency).toBe('BRL');expect(result.partial).toBe(false);expect(result.points.map(p=>[p.day,p.spendCents,p.attributedRevenueCents])).toEqual([['2026-11-16',3000,13000]]);
});
test('ADAS-67 campaign and calendar filters change actual totals and keep observed partial periods explicit',()=>{
  const result=buildAdsDashboard(data(),{accountId:'100',campaignId:'c1',days:7});
  expect([result.since,result.until]).toEqual(['2026-11-10','2026-11-16']);expect(result.totals.spendCents).toBe(3000);expect(result.totals.confirmedRevenueCents).toBe(6000);expect(result.totals.paidOrders).toBe(3);expect(result.daysWithData).toBe(2);expect(result.partial).toBe(true);expect(result.partialMetrics).toContain('spendCents');expect(result.totals.roas).toBeNull();expect(result.campaigns.map(c=>c.id)).toEqual(['c1']);
  expect(result.points.map(p=>p.spendCents)).toEqual([null,null,null,null,null,1000,2000]);
});
test('ADAS-67 report corrections and foreign accounts never duplicate or contaminate totals',()=>{
  const old=report('2026-11-16',[metric('c1',{spendCents:999999})],{updatedAt:'2026-11-17T03:00:00Z'});
  const foreign=report('2026-11-16',[metric('foreign',{spendCents:800000})],{accountId:'200'});
  const result=buildAdsDashboard([old,...data(),foreign],{accountId:'100',days:1});expect(result.totals.spendCents).toBe(3000);expect(result.campaigns).toHaveLength(2);
});
test('ADAS-67 unavailable or stale observations produce gaps and never measured zero or a false ratio',()=>{
  const result=buildAdsDashboard([report('2026-11-16',[metric('c1',{spendCents:null,attributedRevenueCents:null}),null,metric('c3',{spendCents:5000,stale:true})],{status:'partial'})],{accountId:'100',days:1});
  expect(result.totals.spendCents).toBeNull();expect(result.points[0].spendCents).toBeNull();expect(result.totals.roas).toBeNull();expect(result.partial).toBe(true);expect(result.totals.confirmedRevenueCents).toBe(5000);expect(result.partialMetrics).toContain('confirmedRevenueCents');
});
test('ADAS-67 measured zero is shown as zero while undefined CPA and ROAS remain unavailable',()=>{
  const result=buildAdsDashboard([report('2026-11-16',[metric('c1',{spendCents:0,attributedRevenueCents:0,confirmedRevenueCents:0,paidOrders:0,conversations:0,contributionCents:null})])],{accountId:'100',days:1});
  expect(result.totals.spendCents).toBe(0);expect(result.points[0].spendCents).toBe(0);expect(result.totals.paidOrders).toBe(0);expect(result.totals.costPerPurchaseCents).toBeNull();expect(result.totals.roas).toBeNull();expect(result.totals.contributionCents).toBeNull();
});
test('ADAS-67 currencies never imply an exchange rate and selecting one campaign restores its currency',()=>{
  const reports=[report('2026-11-16',[metric(),metric('usd',{currency:'USD',spendCents:500})])];
  const mixed=buildAdsDashboard(reports,{accountId:'100',days:1});expect(mixed.currency).toBeNull();expect(mixed.totals.spendCents).toBeNull();expect(mixed.totals.paidOrders).toBe(4);expect(mixed.totals.roas).toBeNull();expect(mixed.partial).toBe(true);
  const single=buildAdsDashboard(reports,{accountId:'100',campaignId:'usd',days:1});expect(single.currency).toBe('USD');expect(single.totals.spendCents).toBe(500);
});
test('ADAS-67 a changed account timezone does not splice incompatible daily windows into the series',()=>{
  const reports=[report('2026-11-16',[metric()]),report('2026-11-15',[metric('c1',{spendCents:900000})],{timezone:'UTC'})];
  const result=buildAdsDashboard(reports,{accountId:'100',days:7});expect(result.timezone).toBe('America/Sao_Paulo');expect(result.points.at(-2)?.spendCents).toBeNull();expect(result.totals.spendCents).toBe(2000);expect(result.daysWithData).toBe(1);expect(result.partial).toBe(true);
});
test('ADAS-67 an empty account or an absent selected campaign has no manufactured KPI values',()=>{
  const empty=buildAdsDashboard([],{accountId:'100',days:7});expect(empty.hasData).toBe(false);expect(empty.points).toEqual([]);expect(Object.values(empty.totals).every(v=>v===null)).toBe(true);
  const unknown=buildAdsDashboard(data(),{accountId:'100',campaignId:'missing',days:1});expect(unknown.hasData).toBe(false);expect(unknown.totals.spendCents).toBeNull();expect(unknown.points[0].spendCents).toBeNull();
});
