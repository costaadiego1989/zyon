import assert from 'node:assert/strict';
import {test} from 'node:test';
import {campaignApprovalHttpFixture} from './__tests__/campaign-approval-http-fixture.js';

test('ACAP-12 HTTP review returns frozen products media financial terms and next action without private history',async()=>{
  const f=await campaignApprovalHttpFixture();try{
    const response=await f.request(`/campaigns/${f.campaignId}/launch-review?proposal=${f.p.id}`);assert.equal(response.status,200);const view=await response.json();
    assert.equal(view.canApprove,true);assert.deepEqual(view.missing,[]);assert.deepEqual(view.campaign.draft,f.p.after.draft);assert.deepEqual(view.campaign.products,f.p.after.products);assert.deepEqual(view.media,f.p.after.media);assert.equal(view.proposal.digest,f.p.digest);assert.equal(view.proposal.kind,'launch');
    assert.equal(view.proposal.connectionEpoch,f.p.connectionEpoch);
    for(const field of ['remoteBefore','productVersions','encryptedAccessToken','clientConversationId',f.thread.id])assert.equal(JSON.stringify(view).includes(field),false);
    assert.equal(await f.repo.getRecord('store-a',`proposal-approval:${f.p.id}`),null);assert.equal(f.calls.includes('launch'),false);
  }finally{await f.closeHttp();}
});
test('ACAP-18 HTTP second administrator reads canonical review without joining the private thread',async()=>{
  const f=await campaignApprovalHttpFixture();try{const response=await f.request(`/campaigns/${f.campaignId}/launch-review`,'GET',undefined,'admin-a');assert.equal(response.status,200);assert.equal((await response.json()).proposal.id,f.p.id);assert.equal(await f.repo.getRecord('store-a',`proposal-approval:${f.p.id}`),null);}finally{await f.closeHttp();}
});
test('ACAP-18 HTTP valid foreign session cannot read another stores campaign or preparation',async()=>{
  const f=await campaignApprovalHttpFixture();try{for(const path of ['launch-review','preparation']){const response=await f.request(`/campaigns/${f.campaignId}/${path}`,'GET',undefined,'owner-b');assert.equal(response.status,403);assert.equal(JSON.stringify(await response.json()).includes(f.p.digest),false);}assert.equal(f.calls.includes('launch'),false);}finally{await f.closeHttp();}
});
test('ACAP-18 HTTP review denies anonymous expired tampered and revoked JWT sessions',async()=>{
  const f=await campaignApprovalHttpFixture();try{const path=`/campaigns/${f.campaignId}/launch-review`;for(const token of [null,'expired',f.tokens['owner-a'].slice(0,-12)+'tampered1234'])assert.equal((await f.request(path,'GET',undefined,token)).status,401);await f.sql.query("UPDATE merchant_auth_sessions SET revoked_at=now() WHERE user_id='owner-a'");assert.equal((await f.request(path)).status,401);assert.equal(await f.repo.getRecord('store-a',`proposal-approval:${f.p.id}`),null);}finally{await f.closeHttp();}
});
test('ACAP-18 HTTP review denies staff disabled users and changed current membership',async()=>{
  const f=await campaignApprovalHttpFixture();try{const path=`/campaigns/${f.campaignId}/launch-review`;assert.equal((await f.request(path,'GET',undefined,'staff-a')).status,403);await f.sql.query("UPDATE merchant_users SET disabled_at=now() WHERE id='admin-a'");assert.equal((await f.request(path,'GET',undefined,'admin-a')).status,401);await f.sql.query("UPDATE merchant_team_members SET role='STAFF' WHERE user_id='owner-a'");assert.equal((await f.request(path)).status,401);}finally{await f.closeHttp();}
});
test('ACAP-25 HTTP preparation status exposes canonical digest and durable jobs without admission on GET',async()=>{
  const f=await campaignApprovalHttpFixture();try{const path=`/campaigns/${f.campaignId}/preparation`;const initial=await f.request(path);assert.equal(initial.status,200);const value=await initial.json();assert.match(value.campaignDigest,/^[a-f0-9]{64}$/);assert.deepEqual(value.preparations,[]);assert.equal((await f.preparations.list('store-a',f.campaignId)).length,0);const job=await f.preparation.request('store-a','owner-a',f.campaignId,{campaignDigest:value.campaignDigest,imageCount:1});const next=await(await f.request(path)).json();assert.equal(next.preparations[0].id,job.id);assert.equal(Object.hasOwn(next.preparations[0],'requestedBy'),false);assert.equal(f.calls.includes('launch'),false);}finally{await f.closeHttp();}
});
test('ACAP-14 ACAP-25 HTTP stale review retains frozen content and returns an actionable blocker',async()=>{
  const f=await campaignApprovalHttpFixture();try{await f.repo.mutate('store-a',[],state=>{state.campaigns[f.campaignId].draft.headline='Texto atualizado';return{result:null};});const response=await f.request(`/campaigns/${f.campaignId}/launch-review`);assert.equal(response.status,200);const view=await response.json();assert.equal(view.canApprove,false);assert.ok(view.missing.includes('proposal_stale'));assert.deepEqual(view.campaign.draft,f.p.after.draft);assert.equal(await f.repo.getRecord('store-a',`proposal-approval:${f.p.id}`),null);}finally{await f.closeHttp();}
});
test('ACAP-18 HTTP review query cannot select a tenant actor approval or foreign proposal',async()=>{
  const f=await campaignApprovalHttpFixture();try{assert.equal((await f.request(`/campaigns/${f.campaignId}/launch-review?merchantId=store-b&approve=true`)).status,400);assert.equal((await f.request(`/campaigns/${f.campaignId}/launch-review?proposal=foreign-proposal`)).status,404);assert.equal((await f.request(`/campaigns/${f.campaignId}/preparation?actorId=admin-a`)).status,400);assert.equal(await f.repo.getRecord('store-a',`proposal-approval:${f.p.id}`),null);}finally{await f.closeHttp();}
});

test('ACAP-24 HTTP absent notice preferences return no implicit consent and no connection credentials',async()=>{
  const f=await campaignApprovalHttpFixture();try{const response=await f.request('/campaign-notice-contact');assert.equal(response.status,200);assert.deepEqual(await response.json(),{phoneNumber:null,consented:false,consentVersion:null,consentedAt:null,version:0,updatedAt:null});assert.equal(await f.prisma.metaAdsCampaignNoticeContact.count(),0);}finally{await f.closeHttp();}
});
test('ACAP-24 HTTP another administrator reads the stores persisted purpose-specific contact',async()=>{
  const f=await campaignApprovalHttpFixture();try{const saved=await f.contact.save('store-a','owner-a',{phoneNumber:'+5511988887777',consented:true,expectedVersion:0});const response=await f.request('/campaign-notice-contact','GET',undefined,'admin-a');assert.equal(response.status,200);assert.deepEqual(await response.json(),saved);assert.deepEqual(Object.keys(saved).sort(),['consentVersion','consented','consentedAt','phoneNumber','updatedAt','version'].sort());assert.equal(await f.prisma.metaAdsCampaignNoticeContact.count(),1);}finally{await f.closeHttp();}
});
test('ACAP-24 HTTP notice contact is scoped by authenticated tenant and cannot be selected by query',async()=>{
  const f=await campaignApprovalHttpFixture();try{await f.contact.save('store-a','owner-a',{phoneNumber:'+5511988887777',consented:true,expectedVersion:0});const response=await f.request('/campaign-notice-contact','GET',undefined,'owner-b');assert.equal(response.status,200);assert.equal((await response.json()).phoneNumber,null);assert.equal((await f.request('/campaign-notice-contact?merchantId=store-a','GET',undefined,'owner-b')).status,400);assert.equal(await f.prisma.metaAdsCampaignNoticeContact.count({where:{merchantId:'store-b'}}),0);}finally{await f.closeHttp();}
});
test('ACAP-24 HTTP notice preferences reject anonymous staff expired and revoked administrative sessions',async()=>{
  const f=await campaignApprovalHttpFixture();try{for(const [actor,status] of [[null,401],['staff-a',403],['expired',401]] as const)assert.equal((await f.request('/campaign-notice-contact','GET',undefined,actor)).status,status);await f.sql.query("DELETE FROM merchant_team_members WHERE user_id='admin-a'");assert.equal((await f.request('/campaign-notice-contact','GET',undefined,'admin-a')).status,401);assert.equal(await f.prisma.metaAdsCampaignNoticeContact.count(),0);}finally{await f.closeHttp();}
});
