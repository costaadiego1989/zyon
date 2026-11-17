import assert from 'node:assert/strict';
import {test} from 'node:test';
import {campaignApprovalDatabase} from './__tests__/campaign-approval-database.js';
import {PrismaCampaignPreparationRepository} from './prisma-campaign-preparation.repository.js';

async function fixture(){
  const db=await campaignApprovalDatabase();let now=new Date('2026-11-17T12:00:00Z');const clock=()=>now;
  const first=new PrismaCampaignPreparationRepository(db.prisma,clock),second=new PrismaCampaignPreparationRepository(db.prisma,clock);
  const input={merchantId:'store-a',campaignId:'campaign-a',intentDigest:'a'.repeat(64),campaignDigest:'b'.repeat(64),requestedBy:'owner-a',requestedImages:2};
  return {...db,first,second,input,advance:(ms:number)=>{now=new Date(now.getTime()+ms);}};
}
test('ACAP-10 two instances concurrently admit one preparation identity with its original request',async()=>{
  const f=await fixture();try{
    const [a,b]=await Promise.all([f.first.admit(f.input),f.second.admit(f.input)]);assert.equal(a.id,b.id);assert.equal(a.status,'queued');assert.equal(a.campaignDigest,f.input.campaignDigest);assert.equal(a.requestedBy,'owner-a');assert.equal(a.requestedImages,2);
    assert.equal((await f.sql.query('SELECT count(*) FROM meta_ads_campaign_preparations')).rows[0].count,'1');
  }finally{await f.close();}
});
test('ACAP-10 a repeated intent rejects conflicting quantities without changing persisted work',async()=>{
  const f=await fixture();try{const a=await f.first.admit(f.input);await assert.rejects(f.second.admit({...f.input,requestedImages:3}),{code:'preparation_request_conflict'});assert.deepEqual(await f.first.read('store-a',a.id),a);}finally{await f.close();}
});
test('ACAP-10 only one worker claims a live preparation and its checkpoint survives a new repository',async()=>{
  const f=await fixture();try{
    const job=await f.first.admit(f.input);const claims=await Promise.all([f.first.claim('store-a',job.id),f.second.claim('store-a',job.id)]);assert.equal(claims.filter(Boolean).length,1);const lease=claims.find(Boolean)!;
    await f.first.checkpoint(lease,{generationId:'generation-a',checkpoint:{step:'images_requested'},missing:['campaign_media_required'],error:'campaign_media_required'});
    const saved=await f.second.read('store-a',job.id);assert.equal(saved.generationId,'generation-a');assert.deepEqual(saved.checkpoint,{step:'images_requested'});assert.deepEqual(saved.missing,['campaign_media_required']);assert.equal(saved.error,'campaign_media_required');assert.equal(saved.fence,1);assert.equal(await f.second.claim('store-a',job.id),null);
  }finally{await f.close();}
});
test('ACAP-10 an expired lease cannot commit after a replacement worker claims the same work',async()=>{
  const f=await fixture();try{
    const job=await f.first.admit(f.input),old=(await f.first.claim('store-a',job.id))!;f.advance(120001);const current=(await f.second.claim('store-a',job.id))!;
    assert.equal(current.id,old.id);assert.equal(current.fence,old.fence+1);assert.notEqual(current.leaseToken,old.leaseToken);
    await assert.rejects(f.first.checkpoint(old,{generationId:'stale-generation'}),{code:'preparation_lease_lost'});
    await f.second.checkpoint(current,{generationId:'current-generation'});assert.equal((await f.first.read('store-a',job.id)).generationId,'current-generation');
  }finally{await f.close();}
});
test('ACAP-10 heartbeat preserves the current lease while failed database writes roll back their checkpoint',async()=>{
  const f=await fixture();try{
    const job=await f.first.admit(f.input),lease=(await f.first.claim('store-a',job.id))!;await f.first.checkpoint(lease,{checkpoint:{step:'reserved'}});
    await f.sql.query("ALTER TABLE meta_ads_campaign_preparations ADD CONSTRAINT reject_checkpoint_for_test CHECK (checkpoint->>'step' IS DISTINCT FROM 'forbidden')");
    await assert.rejects(f.first.checkpoint(lease,{checkpoint:{step:'forbidden'},generationId:'must-rollback'}));
    const unchanged=await f.second.read('store-a',job.id);assert.deepEqual(unchanged.checkpoint,{step:'reserved'});assert.equal(unchanged.generationId,null);
    f.advance(119000);await f.first.heartbeat(lease);f.advance(2000);assert.equal(await f.second.claim('store-a',job.id),null);await f.first.checkpoint(lease,{checkpoint:{step:'resumed'}});assert.deepEqual((await f.second.read('store-a',job.id)).checkpoint,{step:'resumed'});
  }finally{await f.close();}
});
test('ACAP-10 a corrected review retains generation and checkpoints while fencing the previous worker',async()=>{
  const f=await fixture();try{
    const job=await f.first.admit(f.input),lease=(await f.first.claim('store-a',job.id))!;await f.first.checkpoint(lease,{generationId:'generation-a',proposalId:'proposal-old',checkpoint:{mediaIds:['media-a']}});
    const revised=await f.second.revise('store-a',job.id,f.input.campaignDigest,{campaignDigest:'c'.repeat(64),requestedBy:'owner-b'});
    assert.equal(revised.id,job.id);assert.equal(revised.intentDigest,job.intentDigest);assert.equal(revised.campaignDigest,'c'.repeat(64));assert.equal(revised.requestedBy,'owner-b');assert.equal(revised.generationId,'generation-a');assert.equal(revised.proposalId,null);assert.equal(revised.status,'queued');assert.deepEqual(revised.checkpoint,{mediaIds:['media-a']});
    await assert.rejects(f.first.finish(lease,'review_ready'),{code:'preparation_lease_lost'});assert.equal((await f.first.list('store-a','campaign-a')).length,1);
    await assert.rejects(f.first.revise('store-a',job.id,f.input.campaignDigest,{campaignDigest:'d'.repeat(64),requestedBy:'owner-a'}),{code:'preparation_version_changed'});
  }finally{await f.close();}
});
test('ACAP-10 pending dates are respected and unknown generation outcomes cannot be reclaimed after lease expiry',async()=>{
  const f=await fixture();try{
    const job=await f.first.admit(f.input),lease=(await f.first.claim('store-a',job.id))!;await f.first.finish(lease,'creative_pending');assert.equal((await f.first.pending()).length,0);f.advance(60001);assert.equal((await f.first.pending()).length,1);
    const resumed=(await f.first.claim('store-a',job.id))!;await f.first.checkpoint(resumed,{generationId:'unknown-generation'});await f.first.finish(resumed,'unknown');f.advance(86400000);
    assert.equal((await f.first.pending()).length,0);assert.equal(await f.second.claim('store-a',job.id),null);
    const revised=await f.second.revise('store-a',job.id,f.input.campaignDigest,{campaignDigest:'c'.repeat(64),requestedBy:'owner-a'});assert.equal(revised.status,'unknown');assert.equal(revised.generationId,'unknown-generation');assert.equal(await f.second.claim('store-a',job.id),null);
  }finally{await f.close();}
});
test('ACAP-10 store scope remains isolated even with the same campaign and generation intent',async()=>{
  const f=await fixture();try{
    const a=await f.first.admit(f.input),b=await f.second.admit({...f.input,merchantId:'store-b',requestedBy:'owner-b'});assert.notEqual(a.id,b.id);
    await assert.rejects(f.second.read('store-b',a.id),{code:'preparation_not_found'});await assert.rejects(f.second.claim('store-b',a.id),{code:'preparation_not_found'});
    assert.deepEqual((await f.second.list('store-b','campaign-a')).map(row=>row.id),[b.id]);
  }finally{await f.close();}
});
test('ACAP-26 deleting a store removes its jobs and invalidates a pending worker without touching another store',async()=>{
  const f=await fixture();try{
    const a=await f.first.admit(f.input),b=await f.second.admit({...f.input,merchantId:'store-b',requestedBy:'owner-b'}),lease=(await f.first.claim('store-a',a.id))!;
    await f.sql.query("DELETE FROM merchants WHERE id='store-a'");await assert.rejects(f.first.checkpoint(lease,{generationId:'after-deletion'}),{code:'preparation_lease_lost'});await assert.rejects(f.first.read('store-a',a.id),{code:'preparation_not_found'});
    assert.deepEqual((await f.second.pending()).map(row=>row.id),[b.id]);
  }finally{await f.close();}
});
