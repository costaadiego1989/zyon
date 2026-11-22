import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {MetaAdsCampaign,MetaAdsMetrics} from '@zyon/shared-types';
import {applicationFixture} from './__tests__/fixture.js';
import {CampaignWorkspaceQueryService} from './campaign-workspace-query.service.js';

const now='2026-11-22T12:00:00.000Z',period={since:'2026-11-16',until:'2026-11-22'};
function campaign(i:number):MetaAdsCampaign{return{id:`campaign-${String(i).padStart(2,'0')}`,draft:{name:`Campanha ${i}`,priority:'paid_sales',destination:'store',variantIds:['v1'],budget:{currency:'BRL',amountCents:2000,cadence:'daily',startsAt:'2026-11-16T12:00:00Z',endsAt:'2026-11-30T12:00:00Z'},country:'BR',mediaIds:[],headline:'Produto',primaryText:'Conheça o produto'},products:[{productId:'p1',variantId:'v1',name:'Câmera Wi-Fi',description:'',sku:'C1',priceCents:9900,currency:'BRL',imageUrl:'https://images.example.test/camera.png',stockQuantity:10,active:true,storefrontUrl:'https://store.example.test/camera',commercialVersion:'v1'}],createdByAgent:true,managed:true,remoteAccountId:'100',remoteCampaignId:i%2?String(200+i):null,remoteAdSetId:null,remoteAdIds:[],status:i%2?'delivered':'draft',createdAt:now,updatedAt:new Date(Date.parse(now)-i*1000).toISOString()};}
function metrics(id:string):MetaAdsMetrics{return{campaignId:id,...period,updatedAt:now,timezone:'America/Sao_Paulo',currency:'BRL',attributionWindow:'7d_click+1d_view',source:'meta_reported+zyon_reconciled',spendCents:1000,attributedRevenueCents:19900,confirmedRevenueCents:0,paidOrders:0,conversations:0,costPerPurchaseCents:null,roas:19.9,contributionCents:null,costCoverage:'unavailable',stale:false,notes:[]};}
async function setup(){const f=await applicationFixture();f.setNow(now);await f.repo.mutate('store-a',[],s=>{s.connection={...s.connection,status:'connected',epoch:1,account:{id:'100',name:'Conta'}};for(let i=1;i<=12;i++){const c=campaign(i);s.campaigns[c.id]=c;s.metrics[c.id]=metrics(c.id);}return{result:null};});return{...f,query:new CampaignWorkspaceQueryService({repo:f.repo,clock:f.clock,canManage:async()=>true})};}

test('ACW-03 audience provenance distinguishes planned verified and unavailable settings',async t=>{
 const f=await setup();t.after(()=>f.close());await f.repo.mutate('store-a',[],s=>{s.audienceSnapshots={'campaign-01':{source:'verified',countries:['PT'],minimumAge:25,maximumAge:55,automatic:false,checkedAt:now}};s.campaigns['campaign-03'].createdByAgent=false;return{result:null};});
 assert.deepEqual((await f.query.detail('store-a','campaign-01',period)).audience,{source:'verified',countries:['PT'],minimumAge:25,maximumAge:55,automatic:false,checkedAt:now});
 assert.deepEqual((await f.query.detail('store-a','campaign-02',period)).audience,{source:'planned',countries:['BR'],minimumAge:18,maximumAge:null,automatic:true,checkedAt:null});
 assert.deepEqual((await f.query.detail('store-a','campaign-03',period)).audience,{source:'unavailable',countries:[],minimumAge:null,maximumAge:null,automatic:null,checkedAt:null});
 await f.repo.mutate('store-a',[],s=>{s.campaigns['campaign-02'].draft.country='12';return{result:null};});
 assert.deepEqual((await f.query.detail('store-a','campaign-02',period)).audience,{source:'unavailable',countries:[],minimumAge:null,maximumAge:null,automatic:null,checkedAt:null});
});
test('ACW-08 one query drives matching counts stable order and ten row pagination',async t=>{
 const f=await setup();t.after(()=>f.close());const first=await f.query.list('store-a',{...period});assert.equal(first.items.length,10);assert.equal(first.total,12);assert.equal(first.counts.all,12);assert.equal(first.counts.running,6);assert.equal(first.counts.drafts,6);assert.deepEqual(first.items.map(r=>r.campaign.id),Array.from({length:10},(_,i)=>`campaign-${String(i+1).padStart(2,'0')}`));
 const second=await f.query.list('store-a',{...period,page:2});assert.deepEqual(second.items.map(r=>r.campaign.id),['campaign-11','campaign-12']);assert.equal(second.pages,2);
 const found=await f.query.list('store-a',{...period,search:'CAMERA',filter:'running'});assert.equal(found.total,6);assert.equal(found.counts.all,12);assert.equal(found.counts.running,6);assert.equal(found.query.search,'CAMERA');
 const empty=await f.query.list('store-a',{...period,search:'inexistente'});assert.equal(empty.total,0);assert.deepEqual(empty.items,[]);assert.equal(empty.counts.all,0);
});
test('workspace archive and deletion never inflate current counts or resurrect hidden drafts',async t=>{
 const f=await setup();t.after(()=>f.close());await f.repo.mutate('store-a',[],s=>{s.campaigns['campaign-01'].managed=false;s.campaigns['campaign-01'].lifecycle={state:'archived',version:1,changedAt:now};s.campaigns['campaign-02'].lifecycle={state:'deleted_draft',version:1,changedAt:now};return{result:null};});
 const page=await f.query.list('store-a',period);assert.equal(page.total,10);assert.equal(page.counts.all,10);assert.equal(page.counts.archived,1);assert.equal(page.items.some(r=>['campaign-01','campaign-02'].includes(r.campaign.id)),false);
 const archived=await f.query.list('store-a',{...period,filter:'archived'});assert.deepEqual(archived.items.map(r=>r.campaign.id),['campaign-01']);assert.equal(archived.items[0].metrics?.spendCents,1000);assert.deepEqual(archived.items[0].actions,{pause:false,deleteDraft:false,archive:false,verifyRemote:false});
 await assert.rejects(f.query.detail('store-a','campaign-02',period),{code:'campaign_not_found'});
});
test('workspace metrics cannot borrow values from a different date range or account',async t=>{
 const f=await setup();t.after(()=>f.close());assert.equal((await f.query.detail('store-a','campaign-01',period)).metrics?.paidOrders,0);
 assert.equal((await f.query.detail('store-a','campaign-01',{since:'2026-11-17',until:period.until})).metrics,null);
 await f.repo.mutate('store-a',[],s=>{s.campaigns['campaign-01'].remoteAccountId='999';return{result:null};});const detail=await f.query.detail('store-a','campaign-01',period);assert.equal(detail.metrics,null);assert.equal(detail.actions.pause,false);
});
test('workspace pending approvals exclude stale authority in-flight writes and expired reviews',async t=>{
 const f=await setup();t.after(()=>f.close());await f.repo.mutate('store-a',[],s=>{s.proposals.p1={id:'p1',campaignId:'campaign-02',kind:'launch',status:'pending_review',before:{},after:{},digest:'a'.repeat(64),connectionEpoch:1,reasoning:'Revisar',createdAt:now,approvedAt:null,approvedBy:null,executionId:null,remoteBefore:null,productVersions:{}};return{result:null};});
 assert.equal((await f.query.list('store-a',{...period,filter:'approval'})).total,1);
 await f.repo.mutate('store-a',[],s=>{s.proposals.p1.connectionEpoch=0;return{result:null};});assert.equal((await f.query.list('store-a',{...period,filter:'approval'})).total,0);
 await f.repo.mutate('store-a',[],s=>{s.proposals.p1.connectionEpoch=1;s.executions.e1={id:'e1',proposalId:'p1',campaignId:'campaign-02',status:'execution_unknown',objects:[],error:'unknown',updatedAt:now};return{result:null};});assert.equal((await f.query.list('store-a',{...period,filter:'approval'})).total,0);assert.equal((await f.query.detail('store-a','campaign-02',period)).group,'attention');
 await f.repo.mutate('store-a',[],s=>{s.executions={};s.campaigns['campaign-02'].draft.budget!.endsAt=now;return{result:null};});assert.equal((await f.query.list('store-a',{...period,filter:'approval'})).total,0);
});
test('workspace queries validate input isolate tenants and keep unauthorized history read only',async t=>{
 const f=await setup();t.after(()=>f.close());assert.equal((await f.query.list('store-b',period)).total,0);await assert.rejects(f.query.detail('store-b','campaign-01',period),{code:'campaign_not_found'});
 for(const input of [{page:0},{page:'2x'},{since:'2026-02-30',until:'2026-03-01'},{since:'2026-11-23',until:'2026-11-22'},{filter:'invalid'},{search:'x'.repeat(201)}])await assert.rejects(f.query.list('store-a',{...period,...input} as never),{code:'workspace_query_invalid'});
 const readOnly=new CampaignWorkspaceQueryService({repo:f.repo,clock:f.clock,canManage:async()=>false});assert.deepEqual((await readOnly.detail('store-a','campaign-01',period)).actions,{pause:false,deleteDraft:false,archive:false,verifyRemote:false});assert.equal((await readOnly.list('store-a',period)).total,12);
});
