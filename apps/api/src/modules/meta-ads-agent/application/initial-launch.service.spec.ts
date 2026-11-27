import assert from 'node:assert/strict';
import {test} from 'node:test';
import {InitialLaunchService} from './initial-launch.service.js';
import {campaignLaunchFixture,launchObjects} from './__tests__/launch-fixture.js';

async function fixture(){
  const f=await campaignLaunchFixture();let enabled=true;
  const service=new InitialLaunchService({repo:f.repo,commerce:f.commerce,campaigns:f.service.campaigns,proposals:f.service.proposals,executions:f.executions,preparations:f.preparations,notices:f.notices,authorizeActor:f.authorizeActor,enabled:()=>enabled,clock:f.clock});
  const p=await f.propose('launch'),notice=await f.notices.admit({merchantId:'store-a',campaignId:f.campaignId,proposalId:p.id,proposalDigest:p.digest});
  const input={digest:p.digest,idempotencyKey:'launch-click-a'};
  return{...f,agent:f.service,p,notice,service,input,enabled:(value:boolean)=>{enabled=value;}};
}
test('ACAP-12 ACAP-18 canonical review is available to another store administrator without reading private conversation history',async()=>{
  const f=await fixture();try{
    const view=await f.service.review('store-a','admin-a',f.campaignId,f.p.id);
    assert.equal(view.canApprove,true);assert.deepEqual(view.missing,[]);assert.equal(view.proposal.digest,f.p.digest);assert.deepEqual(view.campaign.draft,f.p.after.draft);assert.deepEqual(view.campaign.products,f.p.after.products);assert.deepEqual(view.media,f.p.after.media);assert.equal(view.notice!.id,f.notice.id);assert.equal(view.execution,null);
    assert.equal(JSON.stringify(view).includes(f.thread.id),false);assert.equal(JSON.stringify(view).includes('accessToken'),false);assert.equal(f.calls.includes('launch'),false);assert.equal(await f.repo.getRecord('store-a',`proposal-approval:${f.p.id}`),null);
    await assert.rejects(f.service.review('store-b','admin-a',f.campaignId,f.p.id),{code:'meta_ads_role_forbidden'});
  }finally{await f.close();}
});
test('ACAP-13 one final approval queues the exact proposal and durable recovery executes it once',async()=>{
  const f=await fixture();try{
    const queued=await f.service.approveAndLaunch('store-a','admin-a',f.campaignId,f.p.id,f.input);
    assert.equal(queued.proposal.status,'approved');assert.equal(queued.canApprove,false);assert.equal(queued.execution,null);assert.equal(f.calls.includes('launch'),false);
    const approval=(await f.repo.getRecord<Record<string,unknown>>('store-a',`proposal-approval:${f.p.id}`))!.payload;
    assert.equal(approval.actorId,'admin-a');assert.equal(approval.digest,f.p.digest);assert.equal(approval.kind,'launch');assert.equal(approval.campaignId,f.campaignId);assert.equal(approval.approvedAt,f.clock().toISOString());
    await f.service.drain();await f.service.drain();const final=await f.service.review('store-a','owner-a',f.campaignId,f.p.id);
    assert.equal(final.execution!.status,'active_unconfirmed');assert.deepEqual(final.execution!.objects,launchObjects);assert.equal(f.calls.filter(call=>call==='launch').length,1);assert.equal(Object.keys((await f.repo.read('store-a')).executions).length,1);assert.equal(final.notice!.reviewState,'approved');
    assert.deepEqual((await f.repo.getRecord('store-a',`proposal-approval:${f.p.id}`))!.payload,approval);
  }finally{await f.close();}
});
test('ACAP-13 two administrators cannot create competing approval receipts for one launch',async()=>{
  const f=await fixture();try{
    const results=await Promise.allSettled([f.service.approveAndLaunch('store-a','owner-a',f.campaignId,f.p.id,f.input),f.service.approveAndLaunch('store-a','admin-a',f.campaignId,f.p.id,{...f.input,idempotencyKey:'other-admin'})]);
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.filter(result=>result.status==='rejected').length,1);
    await f.service.drain();assert.equal(f.calls.filter(call=>call==='launch').length,1);assert.equal((await f.repo.listRecords('store-a','proposal',100)).filter(row=>row.key===`proposal-approval:${f.p.id}`).length,1);
  }finally{await f.close();}
});
test('ACAP-13 a repeated approval key returns the same unknown execution and cannot bind another digest',async()=>{
  const f=await fixture();try{
    let writes=0;f.provider.execute=async(_a,_c,_p,progress)=>{writes++;await progress(launchObjects);throw Error('lost response');};
    await f.service.approveAndLaunch('store-a','owner-a',f.campaignId,f.p.id,f.input);await f.service.drain();
    const replay=await f.service.approveAndLaunch('store-a','owner-a',f.campaignId,f.p.id,f.input);assert.equal(replay.execution!.status,'execution_unknown');const id=replay.execution!.id;
    await f.service.drain();assert.equal((await f.service.review('store-a','owner-a',f.campaignId,f.p.id)).execution!.id,id);assert.equal(writes,1);
    await assert.rejects(f.service.approveAndLaunch('store-a','owner-a',f.campaignId,f.p.id,{...f.input,digest:'b'.repeat(64)}),{code:'launch_request_conflict'});
  }finally{await f.close();}
});
test('ACAP-14 stale draft media catalogue and client digest cannot be approved as the current launch',async()=>{
  for(const change of ['draft','media','catalogue','digest']){
    const f=await fixture();try{
      if(change==='catalogue')f.changeProduct();
      if(change==='draft'||change==='media')await f.repo.mutate('store-a',[],state=>{if(change==='draft')state.campaigns[f.campaignId].draft.headline='Outro texto';else state.media['media-a'].url='https://media.example.test/new.png';return{result:null};});
      await assert.rejects(f.service.approveAndLaunch('store-a','owner-a',f.campaignId,f.p.id,{...f.input,digest:change==='digest'?'b'.repeat(64):f.p.digest}));
      assert.equal(await f.repo.getRecord('store-a',`proposal-approval:${f.p.id}`),null);assert.equal(Object.keys((await f.repo.read('store-a')).executions).length,0);assert.equal(f.calls.includes('launch'),false);
    }finally{await f.close();}
  }
});
test('ACAP-18 revoked role and foreign campaign are denied before an approval request is persisted',async()=>{
  const f=await fixture();try{
    f.role(false);await assert.rejects(f.service.approveAndLaunch('store-a','owner-a',f.campaignId,f.p.id,f.input),{code:'meta_ads_role_forbidden'});f.role(true);
    const other=await f.agent.campaigns.create('store-a',{...(await f.agent.campaigns.owned('store-a',f.campaignId)).draft,mediaIds:[]},'other-review');
    await assert.rejects(f.service.review('store-a','owner-a',other.id,f.p.id),{code:'proposal_not_found'});assert.equal(await f.repo.getRecord('store-a',`proposal-approval:${f.p.id}`),null);
  }finally{await f.close();}
});
test('ACAP-13 an approved durable launch waits while the administrative role is revoked and resumes under current authority',async()=>{
  const f=await fixture();try{
    await f.service.approveAndLaunch('store-a','owner-a',f.campaignId,f.p.id,f.input);f.role(false);await f.service.drain();
    assert.equal(f.calls.includes('launch'),false);assert.equal(Object.keys((await f.repo.read('store-a')).executions).length,0);
    f.role(true);await f.service.drain();assert.equal(f.calls.filter(call=>call==='launch').length,1);assert.equal((await f.service.review('store-a','owner-a',f.campaignId,f.p.id)).execution!.status,'active_unconfirmed');
  }finally{await f.close();}
});
test('ACAP-13 disabled launch engine preserves the queued review without making a provider call',async()=>{
  const f=await fixture();try{
    f.enabled(false);const blocked=await f.service.review('store-a','owner-a',f.campaignId,f.p.id);assert.equal(blocked.canApprove,false);assert.ok(blocked.missing.includes('campaign_launch_unavailable'));
    await assert.rejects(f.service.approveAndLaunch('store-a','owner-a',f.campaignId,f.p.id,f.input));assert.equal(await f.repo.getRecord('store-a',`proposal-approval:${f.p.id}`),null);
    f.enabled(true);await f.service.approveAndLaunch('store-a','owner-a',f.campaignId,f.p.id,f.input);f.enabled(false);await f.service.drain();assert.equal(f.calls.includes('launch'),false);assert.equal((await f.repo.read('store-a')).proposals[f.p.id].status,'approved');
  }finally{await f.close();}
});
test('ACAP-18 client injected authority and approval actors cannot enter a launch request',async()=>{
  const f=await fixture();try{
    await assert.rejects(f.service.approveAndLaunch('store-a','owner-a',f.campaignId,f.p.id,{...f.input,actorId:'admin-a'} as typeof f.input),{code:'launch_request_invalid'});
    assert.equal(await f.repo.getRecord('store-a',`proposal-approval:${f.p.id}`),null);assert.equal(f.calls.includes('launch'),false);
  }finally{await f.close();}
});
