import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CampaignPreparationService} from './campaign-preparation.service.js';
import {campaignLaunchFixture} from './__tests__/launch-fixture.js';
import {campaignPreparationDigest} from '../domain/campaign-preparation.js';

async function fixture(){
  const f=await campaignLaunchFixture();let enabled=true;
  const preparation=new CampaignPreparationService({repo:f.repo,commerce:f.commerce,campaigns:f.service.campaigns,connection:f.service.connection,preparations:f.preparations,authorizeActor:f.authorizeActor,enabled:()=>enabled,clock:f.clock});
  const input=async()=>({campaignDigest:campaignPreparationDigest(await f.service.campaigns.owned('store-a',f.campaignId)),imageCount:1});
  const noMedia=async()=>{const c=await f.service.campaigns.owned('store-a',f.campaignId);await f.service.campaigns.save('store-a',f.campaignId,{...c.draft,mediaIds:[]});await f.repo.mutate('store-a',[],state=>{state.media={};return{result:null};});};
  return{...f,preparation,input,noMedia,enabled:(value:boolean)=>{enabled=value;}};
}
test('ACAP-06 explicit authenticated preparation admits one scoped durable job without financial or image dispatch',async()=>{
  const f=await fixture();try{
    const input=await f.input(),[first,second]=await Promise.all([f.preparation.request('store-a','owner-a',f.campaignId,input),f.preparation.request('store-a','owner-a',f.campaignId,input)]);
    assert.equal(first.id,second.id);assert.equal(first.status,'queued');assert.equal(first.requestedImages,1);assert.equal((await f.preparations.list('store-a',f.campaignId)).length,1);assert.equal((await f.preparations.read('store-a',first.id)).requestedBy,'owner-a');
    assert.equal(Object.hasOwn(first,'leaseToken'),false);const state=await f.repo.read('store-a');assert.equal(Object.keys(state.generations).length,0);assert.equal(Object.keys(state.proposals).length,0);assert.equal(state.credits.monthlyAvailable,30);assert.equal(f.calls.includes('launch'),false);
  }finally{await f.close();}
});
test('ACAP-09 disabled preparation engine persists its reason and never consumes images or buys extras',async()=>{
  const f=await fixture();try{await f.noMedia();f.enabled(false);const job=await f.preparation.request('store-a','owner-a',f.campaignId,await f.input());assert.equal(job.status,'blocked');assert.ok(job.missing.includes('campaign_preparation_unavailable'));assert.equal(job.error,'campaign_preparation_unavailable');const state=await f.repo.read('store-a');assert.equal(state.credits.monthlyAvailable,30);assert.equal(Object.keys(state.generations).length,0);assert.equal(f.calls.some(call=>call.includes('checkout')),false);}finally{await f.close();}
});
test('ACAP-09 insufficient authorized image credit blocks a new creative without changing the draft',async()=>{
  const f=await fixture();try{await f.noMedia();await f.repo.mutate('store-a',[],state=>{state.credits.monthlyAvailable=0;state.credits.extraAvailable=0;return{result:null};});const before=await f.service.campaigns.owned('store-a',f.campaignId),job=await f.preparation.request('store-a','owner-a',f.campaignId,await f.input());assert.equal(job.status,'blocked');assert.ok(job.missing.includes('image_credits_insufficient'));assert.deepEqual((await f.service.campaigns.owned('store-a',f.campaignId)).draft,before.draft);assert.equal(Object.keys((await f.repo.read('store-a')).generations).length,0);assert.equal(f.calls.some(call=>call.includes('checkout')),false);}finally{await f.close();}
});
test('ACAP-09 verified reusable creative remains eligible when no new image allowance is available',async()=>{
  const f=await fixture();try{await f.repo.mutate('store-a',[],state=>{state.credits.monthlyAvailable=0;state.credits.extraAvailable=0;return{result:null};});const job=await f.preparation.request('store-a','owner-a',f.campaignId,await f.input());assert.equal(job.status,'queued');assert.equal(job.error,null);assert.equal((await f.repo.read('store-a')).credits.monthlyAvailable,0);}finally{await f.close();}
});
test('ACAP-10 correcting budget reuses the same generation intent and existing generation checkpoint',async()=>{
  const f=await fixture();try{
    const first=await f.preparation.request('store-a','owner-a',f.campaignId,await f.input()),lease=(await f.preparations.claim('store-a',first.id))!;await f.preparations.checkpoint(lease,{generationId:'already-reserved',checkpoint:{mediaIds:['media-a'],proposalRequestKey:'old-review'}});
    const c=await f.service.campaigns.owned('store-a',f.campaignId);await f.service.campaigns.save('store-a',f.campaignId,{...c.draft,budget:{...c.draft.budget!,amountCents:9000}});
    const second=await f.preparation.request('store-a','admin-a',f.campaignId,await f.input()),stored=await f.preparations.read('store-a',second.id);
    assert.equal(first.id,second.id);assert.equal(first.intentDigest,second.intentDigest);assert.equal(stored.generationId,'already-reserved');assert.equal(stored.requestedBy,'admin-a');assert.equal(stored.proposalId,null);assert.deepEqual(stored.checkpoint,{mediaIds:['media-a']});await assert.rejects(f.preparations.finish(lease,'review_ready'),{code:'preparation_lease_lost'});
  }finally{await f.close();}
});
test('ACAP-14 an explicit preparation request refreshes a stale connection review without regenerating verified media',async()=>{
  const f=await fixture();try{
    const job=await f.preparation.request('store-a','owner-a',f.campaignId,await f.input()),p=await f.propose('launch'),lease=(await f.preparations.claim('store-a',job.id))!;await f.preparations.checkpoint(lease,{proposalId:p.id,checkpoint:{proposalRequestKey:'old-review'}});await f.preparations.finish(lease,'review_ready');
    await f.repo.mutate('store-a',[],state=>{state.connection.epoch++;state.proposals[p.id].status='stale';return{result:null};});
    const repeated=await f.preparation.request('store-a','owner-a',f.campaignId,await f.input());assert.equal(repeated.id,job.id);assert.equal(repeated.status,'queued');assert.equal(repeated.proposalId,null);assert.deepEqual((await f.preparations.read('store-a',job.id)).checkpoint,{});assert.equal((await f.repo.read('store-a')).credits.monthlyAvailable,30);
  }finally{await f.close();}
});
test('ACAP-06 stale digest foreign actor entitlement and injected authority are denied before job admission',async()=>{
  const f=await fixture();try{
    const input=await f.input();await assert.rejects(f.preparation.request('store-b','owner-a',f.campaignId,input),{code:'meta_ads_role_forbidden'});
    f.role(false);await assert.rejects(f.preparation.request('store-a','owner-a',f.campaignId,input),{code:'meta_ads_role_forbidden'});f.role(true);
    await assert.rejects(f.preparation.request('store-a','owner-a',f.campaignId,{...input,campaignDigest:'a'.repeat(64)}),{code:'preparation_version_changed'});
    await assert.rejects(f.preparation.request('store-a','owner-a',f.campaignId,{...input,requestedBy:'admin-a'} as typeof input),{code:'preparation_request_invalid'});
    f.setNow('2026-12-02T12:00:00Z');await assert.rejects(f.preparation.request('store-a','owner-a',f.campaignId,input),{code:'addon_not_entitled'});assert.equal((await f.preparations.list('store-a',f.campaignId)).length,0);
  }finally{await f.close();}
});
test('ACAP-07 changed catalogue or missing setup persists a blocker without provider generation',async()=>{
  for(const change of ['catalogue','connection']){const f=await fixture();try{const input=await f.input();if(change==='catalogue')f.changeProduct();else await f.service.connection.disconnect('store-a');const job=await f.preparation.request('store-a','owner-a',f.campaignId,input);assert.equal(job.status,'blocked');assert.ok(job.missing.includes(change==='catalogue'?'campaign_products_unavailable':'meta_connection_required'));assert.equal(Object.keys((await f.repo.read('store-a')).generations).length,0);}finally{await f.close();}}
});
test('ACAP-06 reading preparation status never admits old drafts and preserves unknown paid outcomes',async()=>{
  const f=await fixture();try{
    const empty=await f.preparation.read('store-a','owner-a',f.campaignId);assert.deepEqual(empty.preparations,[]);assert.equal(empty.campaignDigest,(await f.input()).campaignDigest);
    const job=await f.preparation.request('store-a','owner-a',f.campaignId,await f.input()),lease=(await f.preparations.claim('store-a',job.id))!;await f.preparations.checkpoint(lease,{generationId:'uncertain-image',error:'image_provider_outcome_unknown'});await f.preparations.finish(lease,'unknown');
    const repeated=await f.preparation.request('store-a','owner-a',f.campaignId,await f.input());assert.equal(repeated.id,job.id);assert.equal(repeated.status,'unknown');assert.equal(repeated.generationId,'uncertain-image');assert.equal(await f.preparations.claim('store-a',job.id),null);
  }finally{await f.close();}
});
