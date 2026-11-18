import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CampaignReadyNoticeWorker} from './campaign-ready-notice.worker.js';
import {campaignNoticeFixture} from './__tests__/campaign-notice-fixture.js';
import {CampaignPreparationService} from '../application/campaign-preparation.service.js';
import {CampaignPreparationWorker} from './campaign-preparation.worker.js';
import {campaignPreparationDigest} from '../domain/campaign-preparation.js';
import {ProposalService} from '../application/proposal.service.js';

async function fixture(){
  const f=await campaignNoticeFixture({inbox:false,claim:false});let whatsapp=true;
  const deps={repo:f.repo,launches:f.launches,notices:f.notices,sender:f.sender,reviewActor:async(merchantId:string)=>merchantId==='store-a'?'owner-a':null,dashboardUrl:'https://dashboard.example.test',enabled:()=>true,whatsappEnabled:()=>whatsapp,clock:f.clock};
  return{...f,deps,worker:new CampaignReadyNoticeWorker(deps),whatsapp:(value:boolean)=>{whatsapp=value;},advance:()=>f.setNow(new Date(f.clock().getTime()+121000).toISOString())};
}
test('ACAP-17 inbox and dispatch ledger exist before the physical readiness notification POST',async()=>{
  const f=await fixture();try{
    const transport=globalThis.fetch;globalThis.fetch=async(url,init)=>{assert.equal(await f.prisma.merchantNotification.count(),1);const id=JSON.parse(String(init?.body)).biz_opaque_callback_data;assert.equal((await f.prisma.whatsAppDelivery.findUniqueOrThrow({where:{id}})).state,'sending');assert.ok((await f.notices.read('store-a',f.notice.id)).inboxCreatedAt);return transport(url,init);};
    await f.worker.drain();const rows=await f.prisma.merchantNotification.findMany();assert.equal(rows.length,1);assert.equal(rows[0].type,'campaign_ready');assert.equal(rows[0].title,'Campanha pronta para aprovação');assert.equal((rows[0].metadata as {proposalDigest:string}).proposalDigest,f.p.digest);assert.equal((await f.notices.read('store-a',f.notice.id)).whatsappStatus,'accepted');assert.equal(f.requests.length,1);
  }finally{await f.close();}
});
test('ACAP-17 two notice workers create one inbox and one physical send',async()=>{
  const f=await fixture();try{const other=new CampaignReadyNoticeWorker(f.deps);await Promise.all([f.worker.drain(),other.drain()]);await f.worker.drain();assert.equal(await f.prisma.merchantNotification.count(),1);assert.equal(await f.prisma.whatsAppDelivery.count(),1);assert.equal(f.requests.length,1);assert.equal((await f.notices.read('store-a',f.notice.id)).whatsappStatus,'accepted');}finally{await f.close();}
});
test('ACAP-17 an inbox persistence failure is recoverable and never precedes a WhatsApp send',async()=>{
  const f=await fixture();try{const ensure=f.notices.ensureInbox.bind(f.notices);let failed=false;f.notices.ensureInbox=async(...args)=>{if(!failed){failed=true;throw Error('inbox unavailable');}return ensure(...args);};await f.worker.drain();assert.equal(await f.prisma.merchantNotification.count(),0);assert.equal(f.requests.length,0);await f.worker.drain();assert.equal(await f.prisma.merchantNotification.count(),1);assert.equal(f.requests.length,1);}finally{await f.close();}
});
test('ACAP-20 missing WhatsApp consent preserves a usable panel notification',async()=>{
  const f=await fixture();try{await f.contacts.save('store-a','owner-a',{phoneNumber:'+5511988887777',consented:false,expectedVersion:1});await f.worker.drain();assert.equal(await f.prisma.merchantNotification.count(),1);const row=await f.notices.read('store-a',f.notice.id);assert.equal(row.whatsappStatus,'blocked');assert.equal(row.error,'campaign_notice_contact_required');assert.equal(f.requests.length,0);}finally{await f.close();}
});
test('ACAP-20 disabling WhatsApp dispatch still allows the internal inbox to recover',async()=>{
  const f=await fixture();try{f.whatsapp(false);await f.worker.drain();assert.equal(await f.prisma.merchantNotification.count(),1);assert.equal((await f.notices.read('store-a',f.notice.id)).error,'campaign_notice_unavailable');assert.equal(f.requests.length,0);}finally{await f.close();}
});
test('ACAP-22 a crash after provider POST before persistence expires into unknown without another send',async()=>{
  const f=await fixture();try{const complete=f.notices.completeDispatch.bind(f.notices);f.notices.completeDispatch=async()=>{throw Error('database lost after POST');};await f.worker.drain();const interrupted=await f.notices.read('store-a',f.notice.id);assert.equal(interrupted.whatsappStatus,'sending');assert.ok(interrupted.dispatchStartedAt);assert.equal(f.requests.length,1);f.notices.completeDispatch=complete;f.advance();await f.worker.drain();assert.equal((await f.notices.read('store-a',f.notice.id)).whatsappStatus,'unknown');assert.equal(f.requests.length,1);assert.equal(await f.prisma.whatsAppDelivery.count(),1);}finally{await f.close();}
});
test('ACAP-23 an approval before dispatch creates an approved inbox rather than another awaiting-approval message',async()=>{
  const f=await fixture();try{await f.service.proposals.approve('store-a',f.p.id,'owner-a',f.p.digest);await f.worker.drain();const row=await f.notices.read('store-a',f.notice.id),inbox=await f.prisma.merchantNotification.findUniqueOrThrow({where:{id:row.notificationId}});assert.equal(row.reviewState,'approved');assert.equal(inbox.title,'Campanha aprovada');assert.match(inbox.body!,/aprovação.*registrada/);assert.equal(f.requests.length,0);await f.worker.drain();assert.equal(await f.prisma.merchantNotification.count(),1);}finally{await f.close();}
});
test('ACAP-23 a superseded version updates its existing read inbox and a new version emits one new notice',async()=>{
  const f=await fixture();try{await f.worker.drain();await f.prisma.merchantNotification.update({where:{id:f.notice.notificationId},data:{read:true}});f.advance();const c=await f.service.campaigns.owned('store-a',f.campaignId);await f.service.campaigns.save('store-a',f.campaignId,{...c.draft,budget:{...c.draft.budget!,amountCents:9000}});const p=await f.propose('launch');await f.worker.drain();await f.worker.drain();const old=await f.notices.read('store-a',f.notice.id),inbox=await f.prisma.merchantNotification.findUniqueOrThrow({where:{id:old.notificationId}});assert.equal(old.reviewState,'superseded');assert.equal(inbox.read,true);assert.equal(inbox.title,'Campanha atualizada');const notices=await f.notices.list('store-a',f.campaignId);assert.equal(notices.length,2);assert.equal(notices.find(n=>n.proposalId===p.id)!.whatsappStatus,'accepted');assert.equal(await f.prisma.merchantNotification.count(),2);assert.equal(f.requests.length,2);}finally{await f.close();}
});
test('ACAP-19 a contact revoked while the template is checked cannot be sent by the durable worker',async()=>{
  const f=await fixture();try{f.duringSync(async()=>{await f.contacts.save('store-a','owner-a',{phoneNumber:'+5511988887777',consented:false,expectedVersion:1});});await f.worker.drain();assert.equal(f.requests.length,0);assert.equal(await f.prisma.merchantNotification.count(),1);assert.equal((await f.notices.read('store-a',f.notice.id)).whatsappStatus,'blocked');}finally{await f.close();}
});
test('ACAP-17 actual preparation completion reaches the inbox with one ready notice for its frozen proposal',async()=>{
  const f=await fixture();try{
    f.advance();const preparation=new CampaignPreparationService({repo:f.repo,commerce:f.commerce,campaigns:f.service.campaigns,connection:f.service.connection,preparations:f.preparations,authorizeActor:f.authorizeActor,enabled:()=>true,clock:f.clock});
    const prepWorker=new CampaignPreparationWorker({repo:f.repo,commerce:f.commerce,campaigns:f.service.campaigns,connection:f.service.connection,preparations:f.preparations,notices:f.notices,proposals:f.service.proposals,generations:f.service.generations,authorizeActor:f.authorizeActor,enabled:()=>true,clock:f.clock});
    const job=await preparation.request('store-a','owner-a',f.campaignId,{campaignDigest:campaignPreparationDigest(await f.service.campaigns.owned('store-a',f.campaignId)),imageCount:1});await prepWorker.drain();const ready=await f.preparations.read('store-a',job.id);assert.equal(ready.status,'review_ready');assert.ok(ready.proposalId);await f.worker.drain();const messages=await f.prisma.merchantNotification.findMany({where:{title:'Campanha pronta para aprovação'}});assert.equal(messages.length,1);assert.equal((messages[0].metadata as {proposalId:string}).proposalId,ready.proposalId);assert.equal(f.requests.length,1);assert.equal(Object.keys((await f.repo.read('store-a')).executions).length,0);assert.equal((await f.repo.read('store-a')).credits.monthlyAvailable,30);
  }finally{await f.close();}
});
test('ACAP-18 a foreign outbox cannot expose another store campaign or use its sender',async()=>{
  const f=await fixture();try{const other=await f.notices.admit({merchantId:'store-b',campaignId:f.campaignId,proposalId:f.p.id,proposalDigest:f.p.digest});await f.worker.drain();assert.equal(await f.prisma.merchantNotification.count({where:{merchantId:'store-b'}}),0);assert.equal((await f.notices.read('store-b',other.id)).reviewState,'superseded');assert.equal(f.requests.length,1);assert.equal(JSON.stringify(f.requests).includes('store-b'),false);}finally{await f.close();}
});
test('ACAP-23 canonical review ordering follows the newest creation time independently of JSONB key order',async()=>{
  const f=await fixture();try{f.advance();const proposals=new ProposalService(f.repo,f.commerce,f.service.campaigns,f.service.connection,f.provider,f.clock,()=> 'current');const current=await proposals.create('store-a',f.campaignId,{kind:'launch',reasoning:'Nova revisão',idempotencyKey:'new-current'});assert.equal((await f.launches.review('store-a','owner-a',f.campaignId)).proposal.id,current.id);await f.notices.setReviewState('store-a',f.notice.id,'superseded');const old=await f.launches.review('store-a','owner-a',f.campaignId,f.p.id);assert.equal(old.canApprove,false);assert.ok(old.missing.includes('proposal_stale'));}finally{await f.close();}
});
