import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {MetaAdsCampaign,MetaAdsCampaignLifecycleInput} from '@zyon/shared-types';
import {applicationFixture} from './__tests__/fixture.js';
import {installCampaignApprovalSchema} from '../infrastructure/__tests__/campaign-approval-database.js';
import {PrismaCampaignPreparationRepository} from '../infrastructure/prisma-campaign-preparation.repository.js';
import {MetaAdsError,type RemoteSnapshot,type MetaAccess} from '../domain/types.js';
import {CampaignLifecycleService} from './campaign-lifecycle.service.js';

const now='2026-11-22T12:00:00.000Z',input=(key='request-a'):MetaAdsCampaignLifecycleInput=>({expectedVersion:0,idempotencyKey:key});
async function setup(){
 const f=await applicationFixture();f.setNow(now);await installCampaignApprovalSchema(f.sql);
 const c:MetaAdsCampaign={id:'campaign-a',draft:{name:'Produto · Mais vendas · Loja',priority:'paid_sales',destination:'store',variantIds:['v1'],budget:null,country:'BR',mediaIds:[],headline:'Produto',primaryText:'Conheça o produto'},products:[],createdByAgent:true,managed:true,remoteCampaignId:null,remoteAccountId:'100',remoteAdSetId:null,remoteAdIds:[],status:'draft',createdAt:now,updatedAt:now};
 await f.repo.mutate('store-a',[],s=>{s.campaigns[c.id]=c;return{result:null,records:[{key:'campaign-origin:campaign-a',kind:'audit',payload:{source:'agent',campaignId:c.id},createdAt:now}]};});
 let role=true,reads=0;let snapshot:RemoteSnapshot={campaignId:'200',status:'PAUSED',effectiveStatus:'PAUSED',budget:{},targeting:{},adSetId:'300',adIds:['500'],creativeIds:[]};
 const access:MetaAccess={merchantId:'store-a',accessToken:'test-only',connectionEpoch:1,clientConversationId:'test-context',accountId:'100',pageId:'110',datasetId:'120',catalogId:null,whatsappId:null};
 const service=new CampaignLifecycleService({repo:f.repo,commerce:f.commerce,authorizeActor:async(merchantId,actorId)=>{if(!role||merchantId!=='store-a'||!['owner-a','admin-a'].includes(actorId))throw new MetaAdsError('meta_ads_role_forbidden',403);},connection:{access:async()=>access},provider:{snapshot:async()=>{reads++;return structuredClone(snapshot);}},clock:f.clock});
 const preparations=new PrismaCampaignPreparationRepository(f.prisma,f.clock);
 const job=()=>preparations.admit({merchantId:'store-a',campaignId:c.id,intentDigest:'a'.repeat(64),campaignDigest:'b'.repeat(64),requestedBy:'owner-a',requestedImages:1});
 const published=()=>f.repo.mutate('store-a',[],s=>{Object.assign(s.campaigns[c.id],{remoteCampaignId:'200',remoteAdSetId:'300',remoteAdIds:['500'],status:'remote_paused'});return{result:null};});
 return{...f,service,preparations,job,published,setRole:(v:boolean)=>{role=v;},remote:(v:RemoteSnapshot)=>{snapshot=v;},remoteReads:()=>reads,snapshot};
}
test('ACW-11 delete a safe draft invalidates queued work once without consuming credit',async t=>{
 const f=await setup();t.after(()=>f.close());const job=await f.job();const before=await f.repo.read('store-a');
 const [first,repeat]=await Promise.all([f.service.deleteDraft('store-a','owner-a','campaign-a',input()),f.service.deleteDraft('store-a','owner-a','campaign-a',input())]);
 assert.deepEqual(first,repeat);assert.deepEqual(first.lifecycle,{state:'deleted_draft',version:1,changedAt:now});assert.equal(first.managed,false);
 const after=await f.repo.read('store-a');assert.deepEqual(after.credits,before.credits);assert.deepEqual(after.executions,before.executions);assert.equal((await f.preparations.read('store-a',job.id)).status,'superseded');assert.equal(await f.preparations.claim('store-a',job.id),null);
 const records=await f.repo.listRecords('store-a','audit',100);assert.equal(records.filter(r=>r.key.startsWith('campaign-lifecycle:')).length,1);assert.equal(f.remoteReads(),0);
});
test('ACW-12 archive keeps remote identity financial history and refunds available',async t=>{
 const f=await setup();t.after(()=>f.close());await f.published();await f.repo.mutate('store-a',[],s=>{s.metrics.m={campaignId:'campaign-a',since:'2026-11-16',until:'2026-11-22',updatedAt:now,timezone:'America/Sao_Paulo',currency:'BRL',attributionWindow:'7d_click',source:'zyon_reconciled',spendCents:1000,attributedRevenueCents:null,confirmedRevenueCents:8000,paidOrders:1,conversations:null,costPerPurchaseCents:1000,roas:null,contributionCents:null,costCoverage:'unavailable',stale:false,notes:[]};return{result:null};});
 const before=await f.repo.read('store-a'),archived=await f.service.archive('store-a','owner-a','campaign-a',input());assert.equal(archived.lifecycle?.state,'archived');assert.equal(archived.remoteCampaignId,'200');assert.deepEqual(archived.remoteAdIds,['500']);assert.equal(archived.managed,false);
 const after=await f.repo.read('store-a');assert.deepEqual(after.metrics,before.metrics);assert.deepEqual(after.credits,before.credits);assert.deepEqual(after.purchases,before.purchases);assert.deepEqual(after.executions,before.executions);assert.equal(f.remoteReads(),1);
});
test('ACW-13 an active or unknown remote campaign stays visible until pause or verification',async t=>{
 const f=await setup();t.after(()=>f.close());await f.published();f.remote({...f.snapshot,status:'ACTIVE',effectiveStatus:'ACTIVE'});await assert.rejects(f.service.archive('store-a','owner-a','campaign-a',input()),{code:'campaign_pause_required'});
 f.remote({...f.snapshot,status:'UNKNOWN',effectiveStatus:'UNKNOWN'});await assert.rejects(f.service.archive('store-a','owner-a','campaign-a',input()),{code:'campaign_remote_state_unavailable'});
 const c=(await f.repo.read('store-a')).campaigns['campaign-a'];assert.equal(c.managed,true);assert.equal(c.lifecycle,undefined);
});
test('ACW-14 in-flight generation execution and preparation prevent deletion without losing work',async t=>{
 const f=await setup();t.after(()=>f.close());const job=await f.job();await f.preparations.claim('store-a',job.id);await assert.rejects(f.service.deleteDraft('store-a','owner-a','campaign-a',input()),{code:'campaign_operation_pending'});
 await f.sql.query("UPDATE meta_ads_campaign_preparations SET status='blocked',lease_token=NULL,lease_until=NULL WHERE id=$1",[job.id]);
 await f.repo.mutate('store-a',[],s=>{s.generations.g1={id:'g1',campaignId:'campaign-a',requestedImages:1,status:'reserved',mediaIds:[],error:null,createdAt:now,updatedAt:now};return{result:null};});await assert.rejects(f.service.deleteDraft('store-a','owner-a','campaign-a',input()),{code:'campaign_operation_pending'});
 await f.repo.mutate('store-a',[],s=>{s.generations={};s.executions.e1={id:'e1',proposalId:'p1',campaignId:'campaign-a',status:'execution_unknown',objects:[],error:'unknown',updatedAt:now};return{result:null};});await assert.rejects(f.service.deleteDraft('store-a','owner-a','campaign-a',input()),{code:'campaign_operation_pending'});
 const state=await f.repo.read('store-a');assert.equal(state.campaigns['campaign-a'].managed,true);assert.equal(state.executions.e1.status,'execution_unknown');
});
test('lifecycle requires exact version and cannot delete a remotely created campaign',async t=>{
 const f=await setup();t.after(()=>f.close());await assert.rejects(f.service.deleteDraft('store-a','owner-a','campaign-a',{...input(),expectedVersion:1}),{code:'campaign_version_conflict'});await f.published();await assert.rejects(f.service.deleteDraft('store-a','owner-a','campaign-a',input()),{code:'campaign_has_remote_objects'});assert.equal((await f.repo.read('store-a')).campaigns['campaign-a'].managed,true);
});
test('lifecycle actor and tenant checks precede replay and expose no foreign data',async t=>{
 const f=await setup();t.after(()=>f.close());await assert.rejects(f.service.deleteDraft('store-a','staff-a','campaign-a',input()),{code:'meta_ads_role_forbidden'});await assert.rejects(f.service.deleteDraft('store-b','owner-a','campaign-a',input()),{code:'meta_ads_role_forbidden'});await f.service.deleteDraft('store-a','owner-a','campaign-a',input());f.setRole(false);await assert.rejects(f.service.deleteDraft('store-a','owner-a','campaign-a',input()),{code:'meta_ads_role_forbidden'});assert.equal(Object.keys((await f.repo.read('store-b')).campaigns).length,0);
});
test('lifecycle database failure rolls back campaign audit and queued preparation together',async t=>{
 const f=await setup();t.after(()=>f.close());const job=await f.job();await f.sql.query("ALTER TABLE meta_ads_agent_records ADD CONSTRAINT reject_lifecycle_test CHECK (key NOT LIKE 'campaign-lifecycle:%')");
 await assert.rejects(f.service.deleteDraft('store-a','owner-a','campaign-a',input()));const state=await f.repo.read('store-a');assert.equal(state.campaigns['campaign-a'].managed,true);assert.equal(state.campaigns['campaign-a'].lifecycle,undefined);assert.equal((await f.preparations.read('store-a',job.id)).status,'queued');
});
test('lifecycle deletion and a concurrent preparation claim cannot both obtain authority',async t=>{
 const f=await setup();t.after(()=>f.close());const job=await f.job();const [deletion,claim]=await Promise.allSettled([f.service.deleteDraft('store-a','owner-a','campaign-a',input()),f.preparations.claim('store-a',job.id)]);assert.equal(claim.status,'fulfilled');
 const saved=await f.repo.read('store-a'),claimed=claim.status==='fulfilled'?claim.value:null;if(claimed){assert.equal(deletion.status,'rejected');assert.equal(saved.campaigns['campaign-a'].managed,true);assert.equal((await f.preparations.read('store-a',job.id)).status,'preparing');}else{assert.equal(deletion.status,'fulfilled');assert.equal(saved.campaigns['campaign-a'].lifecycle?.state,'deleted_draft');assert.equal((await f.preparations.read('store-a',job.id)).status,'superseded');}
});

test('archive accepts a currently verified pause after a historical confirmed activation without rewriting history',async t=>{const f=await setup();t.after(()=>f.close());await f.published();await f.repo.mutate('store-a',[],s=>{s.executions.activation={id:'activation',proposalId:'launch',campaignId:'campaign-a',status:'active_unconfirmed',objects:[{type:'campaign',id:'200'}],error:null,updatedAt:'2026-11-21T12:00:00Z'};s.proposals.launch={id:'launch',campaignId:'campaign-a',kind:'launch',status:'executed',before:{},after:{},digest:'reviewed',connectionEpoch:1,reasoning:'Versão aprovada',createdAt:'2026-11-21T12:00:00Z',approvedAt:'2026-11-21T12:00:00Z',approvedBy:'owner-a',executionId:'activation'};return{result:null};});const before=await f.repo.read('store-a');const result=await f.service.archive('store-a','owner-a','campaign-a',input());assert.equal(result.lifecycle?.state,'archived');const after=await f.repo.read('store-a');assert.deepEqual(after.executions,before.executions);assert.deepEqual(after.proposals,before.proposals);assert.deepEqual(after.credits,before.credits);assert.equal(f.remoteReads(),1);});
test('archive still refuses an unresolved execution even when the latest provider snapshot is paused',async t=>{const f=await setup();t.after(()=>f.close());await f.published();await f.repo.mutate('store-a',[],s=>{s.executions.uncertain={id:'uncertain',proposalId:'change',campaignId:'campaign-a',status:'execution_unknown',objects:[],error:'meta_execution_unknown',updatedAt:now};return{result:null};});await assert.rejects(f.service.archive('store-a','owner-a','campaign-a',input()),{code:'campaign_operation_pending'});assert.equal((await f.repo.read('store-a')).campaigns['campaign-a'].managed,true);});
