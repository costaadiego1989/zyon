import assert from 'node:assert/strict';
import {test} from 'node:test';
import {campaignApprovalDatabase} from './__tests__/campaign-approval-database.js';
import {PrismaCampaignReadyNoticeRepository} from './prisma-campaign-ready-notice.repository.js';
import {CAMPAIGN_NOTICE_CONSENT_VERSION,publicCampaignReadyNotice,type CampaignNoticeSnapshot} from '../domain/campaign-ready-notice.port.js';

async function fixture(){
  const db=await campaignApprovalDatabase();let now=new Date('2026-11-17T12:00:00Z');const clock=()=>now;
  const first=new PrismaCampaignReadyNoticeRepository(db.prisma,clock),second=new PrismaCampaignReadyNoticeRepository(db.prisma,clock);
  const input={merchantId:'store-a',campaignId:'campaign-a',proposalId:'proposal-a',proposalDigest:'d'.repeat(64)};
  const inbox={campaignName:'Colecao Camisas',reviewUrl:'https://dashboard.example.test/#meta-ads-agent?store=store-a&campaign=campaign-a&proposal=proposal-a'};
  const snapshot:CampaignNoticeSnapshot={recipientNumber:'+5511988887777',contactVersion:1,consentVersion:CAMPAIGN_NOTICE_CONSENT_VERSION,consentedBy:'owner-a',configId:'config-a',wabaId:'10001',phoneNumberId:'10002',senderNumber:'+5511999990000',templateName:'campaign_ready',templateLanguage:'pt_BR',templateRevision:1,templateBodyDigest:'e'.repeat(64)};
  await db.prisma.metaAdsCampaignNoticeContact.create({data:{merchantId:'store-a',phoneNumber:snapshot.recipientNumber,version:1,consentVersion:CAMPAIGN_NOTICE_CONSENT_VERSION,consentedBy:'owner-a',consentedAt:now,updatedAt:now}});
  const ready=async()=>{const notice=await first.admit(input);await first.ensureInbox('store-a',notice.id,inbox);const lease=(await first.claim('store-a',notice.id))!;return first.pinRecipient(lease,snapshot);};
  return {...db,first,second,input,inbox,snapshot,ready,advance:(ms:number)=>{now=new Date(now.getTime()+ms);}};
}
test('ACAP-17 concurrent admission keeps one logical notice per exact review without automatically pinning a recipient',async()=>{
  const f=await fixture();try{const [a,b]=await Promise.all([f.first.admit(f.input),f.second.admit(f.input)]);assert.equal(a.id,b.id);assert.equal(a.notificationId,b.notificationId);assert.equal(a.dispatchSnapshot,null);assert.equal(a.inboxCreatedAt,null);assert.equal(a.proposalDigest,f.input.proposalDigest);assert.equal((await f.prisma.metaAdsCampaignReadyNotice.count()),1);}finally{await f.close();}
});
test('ACAP-17 concurrent inbox creation records one accessible campaign review with a transactional marker',async()=>{
  const f=await fixture();try{
    const notice=await f.first.admit(f.input);await Promise.all([f.first.ensureInbox('store-a',notice.id,f.inbox),f.second.ensureInbox('store-a',notice.id,f.inbox)]);
    const saved=await f.first.read('store-a',notice.id);assert.equal(saved.inboxCreatedAt,'2026-11-17T12:00:00.000Z');const messages=await f.prisma.merchantNotification.findMany();assert.equal(messages.length,1);assert.equal(messages[0].id,notice.notificationId);assert.equal(messages[0].merchantId,'store-a');assert.equal(messages[0].type,'campaign_ready');assert.equal(messages[0].campaignReadyNoticeId,notice.id);assert.equal(messages[0].title,'Campanha pronta para aprovação');assert.ok(messages[0].body!.includes('Colecao Camisas'));assert.deepEqual(messages[0].metadata,{campaignId:'campaign-a',proposalId:'proposal-a',proposalDigest:f.input.proposalDigest,merchantId:'store-a',reviewState:'awaiting_approval',reviewUrl:f.inbox.reviewUrl});
  }finally{await f.close();}
});
test('ACAP-17 a failed inbox marker rolls back the notification and remains recoverable',async()=>{
  const f=await fixture();try{
    const notice=await f.first.admit(f.input);await f.sql.query('ALTER TABLE meta_ads_campaign_ready_notices ADD CONSTRAINT reject_inbox_marker_for_test CHECK (inbox_created_at IS NULL)');await assert.rejects(f.first.ensureInbox('store-a',notice.id,f.inbox));assert.equal(await f.prisma.merchantNotification.count(),0);assert.equal((await f.first.read('store-a',notice.id)).inboxCreatedAt,null);
    await f.sql.query('ALTER TABLE meta_ads_campaign_ready_notices DROP CONSTRAINT reject_inbox_marker_for_test');await f.first.ensureInbox('store-a',notice.id,f.inbox);assert.equal(await f.prisma.merchantNotification.count(),1);
  }finally{await f.close();}
});
test('ACAP-19 delivery admission requires a persisted inbox and current purpose-specific consent',async()=>{
  const f=await fixture();try{
    const notice=await f.first.admit(f.input),lease=(await f.first.claim('store-a',notice.id))!;await assert.rejects(f.first.startDispatch(lease),{code:'campaign_notice_inbox_required'});assert.equal(await f.prisma.whatsAppDelivery.count(),0);
    await f.first.ensureInbox('store-a',notice.id,f.inbox);await f.prisma.metaAdsCampaignNoticeContact.update({where:{merchantId:'store-a'},data:{consentedAt:null,consentedBy:null,consentVersion:null,version:2}});await assert.rejects(f.first.pinRecipient(lease,f.snapshot),{code:'campaign_notice_contact_changed'});assert.equal((await f.first.read('store-a',notice.id)).dispatchSnapshot,null);
  }finally{await f.close();}
});
test('ACAP-19 the eligible recipient is pinned while credentials and full phones never enter the public notice',async()=>{
  const f=await fixture();try{
    const lease=await f.ready();assert.deepEqual(lease.dispatchSnapshot,f.snapshot);const visible=publicCampaignReadyNotice(lease);assert.equal(visible.recipientHint,'•••• 7777');assert.equal(JSON.stringify(visible).includes('5511988887777'),false);assert.equal(Object.hasOwn(visible,'dispatchSnapshot'),false);
    await f.prisma.metaAdsCampaignNoticeContact.update({where:{merchantId:'store-a'},data:{phoneNumber:'+5511977776666',version:2}});await assert.rejects(f.first.pinRecipient(lease,{...f.snapshot,recipientNumber:'+5511977776666',contactVersion:2}),{code:'campaign_notice_recipient_changed'});assert.deepEqual((await f.first.read('store-a',lease.id)).dispatchSnapshot,f.snapshot);
  }finally{await f.close();}
});
test('ACAP-19 a snapshot cannot carry credentials or a self-send recipient',async()=>{
  const f=await fixture();try{
    const notice=await f.first.admit(f.input);await f.first.ensureInbox('store-a',notice.id,f.inbox);const lease=(await f.first.claim('store-a',notice.id))!;
    await assert.rejects(f.first.pinRecipient(lease,{...f.snapshot,accessToken:'must-not-persist'} as never),{code:'campaign_notice_snapshot_invalid'});await assert.rejects(f.first.pinRecipient(lease,{...f.snapshot,senderNumber:f.snapshot.recipientNumber}),{code:'campaign_notice_snapshot_invalid'});assert.equal((await f.first.read('store-a',notice.id)).dispatchSnapshot,null);
  }finally{await f.close();}
});
test('ACAP-19 consent revoked after eligibility prevents dispatch admission',async()=>{
  const f=await fixture();try{
    const lease=await f.ready();await f.prisma.metaAdsCampaignNoticeContact.update({where:{merchantId:'store-a'},data:{consentedAt:null,consentedBy:null,consentVersion:null,version:2}});
    await assert.rejects(f.first.startDispatch(lease),{code:'campaign_notice_contact_changed'});assert.equal(await f.prisma.whatsAppDelivery.count(),0);assert.equal((await f.first.read('store-a',lease.id)).dispatchStartedAt,null);
  }finally{await f.close();}
});
test('ACAP-19 the final dispatch guard revalidates consent through transport preparation awaits',async()=>{
  const f=await fixture();try{
    const lease=await f.ready();await assert.rejects(f.first.assertDispatch(lease),{code:'campaign_notice_dispatch_unknown'});const sending=await f.first.startDispatch(lease);await f.first.assertDispatch(sending);
    await f.prisma.metaAdsCampaignNoticeContact.update({where:{merchantId:'store-a'},data:{consentedAt:null,consentedBy:null,consentVersion:null,version:2}});await assert.rejects(f.first.assertDispatch(sending),{code:'campaign_notice_contact_changed'});assert.equal(await f.prisma.whatsAppDelivery.count(),1);
  }finally{await f.close();}
});
test('ACAP-22 exclusive notice leases fence an old worker and may resume only before dispatch begins',async()=>{
  const f=await fixture();try{
    const notice=await f.first.admit(f.input),claims=await Promise.all([f.first.claim('store-a',notice.id),f.second.claim('store-a',notice.id)]);assert.equal(claims.filter(Boolean).length,1);const old=claims.find(Boolean)!;f.advance(119000);await f.first.heartbeat(old);f.advance(2000);assert.equal(await f.second.claim('store-a',notice.id),null);f.advance(120000);
    const next=(await f.second.claim('store-a',notice.id))!;assert.equal(next.fence,old.fence+1);assert.notEqual(next.leaseToken,old.leaseToken);await assert.rejects(f.first.block(old,'template_unavailable'),{code:'campaign_notice_lease_lost'});
  }finally{await f.close();}
});
test('ACAP-22 dispatch marker and scoped delivery identity are persisted once before the transport',async()=>{
  const f=await fixture();try{
    const lease=await f.ready(),sending=await f.first.startDispatch(lease);assert.equal(sending.dispatchStartedAt,'2026-11-17T12:00:00.000Z');assert.match(sending.deliveryId!,/^campaign_ready:[a-f0-9]{64}$/);
    const delivery=await f.prisma.whatsAppDelivery.findUniqueOrThrow({where:{id:sending.deliveryId!}});assert.equal(delivery.merchantId,'store-a');assert.equal(delivery.configId,'config-a');assert.equal(delivery.deviceId,'10002');assert.equal(delivery.state,'sending');assert.equal(delivery.processingToken,lease.leaseToken);assert.equal(delivery.campaignReadyNoticeId,lease.id);assert.equal((delivery.response as Record<string,unknown>).kind,'campaign_ready');
    await assert.rejects(f.second.startDispatch(lease),{code:'campaign_notice_dispatch_unknown'});assert.equal(await f.prisma.whatsAppDelivery.count(),1);
  }finally{await f.close();}
});
test('ACAP-19 a colliding legacy delivery identity cannot be overwritten or moved from another store',async()=>{
  const f=await fixture();try{
    const lease=await f.ready(),id='campaign_ready:'+lease.id.slice('campaign_notice_'.length);
    await f.prisma.whatsAppDelivery.create({data:{id,merchantId:'store-b',configId:'config-b',deviceId:'10003',state:'sent',processingToken:'foreign',response:{kind:'other'}}});
    await assert.rejects(f.first.startDispatch(lease),{code:'campaign_notice_dispatch_unknown'});const existing=await f.prisma.whatsAppDelivery.findUniqueOrThrow({where:{id}});assert.equal(existing.merchantId,'store-b');assert.equal(existing.configId,'config-b');assert.equal(existing.campaignReadyNoticeId,null);assert.deepEqual(existing.response,{kind:'other'});assert.equal((await f.first.read('store-a',lease.id)).dispatchStartedAt,null);
  }finally{await f.close();}
});
test('ACAP-22 an unknown send retains its snapshot identity and cannot be retried or reset as not dispatched',async()=>{
  const f=await fixture();try{
    const lease=await f.ready(),sending=await f.first.startDispatch(lease);await f.first.completeDispatch(sending,{status:'unknown',reason:'provider_acceptance_unknown'});f.advance(86400000);assert.equal(await f.second.claim('store-a',lease.id),null);assert.equal((await f.second.pending()).length,0);
    await assert.rejects(f.second.completeDispatch(sending,{status:'not_dispatched',reason:'wrong_retry'}));const current=await f.second.read('store-a',lease.id);assert.equal(current.whatsappStatus,'unknown');assert.equal(current.deliveryId,sending.deliveryId);assert.deepEqual(current.dispatchSnapshot,f.snapshot);assert.equal((await f.prisma.whatsAppDelivery.findUniqueOrThrow({where:{id:sending.deliveryId!}})).state,'submission_unknown');
  }finally{await f.close();}
});
test('ACAP-22 an expired sending lease becomes unknown without admitting another dispatch',async()=>{
  const f=await fixture();try{const sending=await f.first.startDispatch(await f.ready());f.advance(120001);assert.equal(await f.second.claim('store-a',sending.id),null);assert.equal((await f.second.read('store-a',sending.id)).whatsappStatus,'unknown');assert.equal(await f.prisma.whatsAppDelivery.count(),1);}finally{await f.close();}
});
test('ACAP-19 a guaranteed not-dispatched result can resume with the same recipient and one delivery ledger',async()=>{
  const f=await fixture();try{
    const sending=await f.first.startDispatch(await f.ready());await f.first.completeDispatch(sending,{status:'not_dispatched',reason:'approved_template_unavailable'});assert.equal((await f.first.read('store-a',sending.id)).dispatchStartedAt,null);f.advance(60001);
    const next=(await f.second.claim('store-a',sending.id))!,pinned=await f.second.pinRecipient(next,{...f.snapshot,templateRevision:2}),retry=await f.second.startDispatch(pinned);assert.equal(retry.deliveryId,sending.deliveryId);const accepted=await f.second.completeDispatch(retry,{status:'accepted',messageId:'wamid.accepted'});assert.equal(accepted.whatsappStatus,'accepted');assert.notEqual(accepted.whatsappStatus,'delivered');assert.equal(await f.prisma.whatsAppDelivery.count(),1);
  }finally{await f.close();}
});
test('ACAP-23 approved or superseded reviews update their existing inbox without emitting again',async()=>{
  const f=await fixture();try{
    const notice=await f.first.admit(f.input);await f.first.ensureInbox('store-a',notice.id,f.inbox);await f.prisma.merchantNotification.update({where:{id:notice.notificationId},data:{read:true}});await f.first.setReviewState('store-a',notice.id,'approved');await f.first.ensureInbox('store-a',notice.id,f.inbox);
    assert.equal(await f.second.claim('store-a',notice.id),null);assert.equal((await f.second.admit(f.input)).reviewState,'approved');const inbox=await f.prisma.merchantNotification.findUniqueOrThrow({where:{id:notice.notificationId}});assert.equal(inbox.read,true);assert.equal((inbox.metadata as Record<string,unknown>).reviewState,'approved');assert.equal(await f.prisma.merchantNotification.count(),1);
  }finally{await f.close();}
});
test('ACAP-23 a review closed before inbox recovery never creates a stale ready-for-approval message',async()=>{
  const f=await fixture();try{
    for(const state of ['approved','superseded'] as const){
      const proposalId=`proposal-${state}`,notice=await f.first.admit({...f.input,proposalId});await f.first.setReviewState('store-a',notice.id,state);
      await f.first.ensureInbox('store-a',notice.id,{...f.inbox,reviewUrl:f.inbox.reviewUrl.replace('proposal-a',proposalId)});
      const inbox=await f.prisma.merchantNotification.findUniqueOrThrow({where:{id:notice.notificationId}});assert.equal(inbox.title,state==='approved'?'Campanha aprovada':'Campanha atualizada');assert.equal(inbox.body!.includes('pronta para aprovação'),false);assert.equal(await f.second.claim('store-a',notice.id),null);
    }
    assert.equal(await f.prisma.whatsAppDelivery.count(),0);
  }finally{await f.close();}
});
test('ACAP-21 a late observed acceptance reconciles unknown without another send or an obsolete error reason',async()=>{
  const f=await fixture();try{
    const sending=await f.first.startDispatch(await f.ready());await f.first.completeDispatch(sending,{status:'unknown',reason:'provider_acceptance_unknown'});
    const accepted=await f.first.completeDispatch(sending,{status:'accepted',messageId:'wamid.late'});assert.equal(accepted.whatsappStatus,'accepted');assert.equal(accepted.error,null);assert.equal(await f.second.claim('store-a',sending.id),null);
    const delivery=await f.prisma.whatsAppDelivery.findUniqueOrThrow({where:{id:sending.deliveryId!}});assert.equal(delivery.providerMessageId,'wamid.late');assert.equal(Object.hasOwn(delivery.response as object,'reason'),false);assert.equal(await f.prisma.whatsAppDelivery.count(),1);
  }finally{await f.close();}
});
test('ACAP-22 an unknown attempt with a known provider ID cannot accept a different message identity',async()=>{
  const f=await fixture();try{
    const sending=await f.first.startDispatch(await f.ready());await f.first.completeDispatch(sending,{status:'unknown',reason:'provider_acceptance_unknown',messageId:'wamid.original'});
    await assert.rejects(f.second.completeDispatch(sending,{status:'accepted',messageId:'wamid.other'}),{code:'campaign_notice_message_changed'});const delivery=await f.prisma.whatsAppDelivery.findUniqueOrThrow({where:{id:sending.deliveryId!}});assert.equal(delivery.providerMessageId,'wamid.original');assert.equal((await f.first.read('store-a',sending.id)).whatsappStatus,'unknown');assert.equal(await f.prisma.whatsAppDelivery.count(),1);
  }finally{await f.close();}
});
test('ACAP-26 deletion cascades only linked campaign notices inbox and delivery records',async()=>{
  const f=await fixture();try{
    const sending=await f.first.startDispatch(await f.ready());const other=await f.second.admit({...f.input,merchantId:'store-b'});await f.prisma.merchantNotification.create({data:{id:'legacy-inbox',merchantId:'store-a',type:'other',title:'Existing'}});await f.prisma.whatsAppDelivery.create({data:{id:'legacy-delivery',merchantId:'store-a',configId:'legacy',deviceId:'legacy',state:'sent',processingToken:'legacy'}});
    await f.prisma.metaAdsCampaignPreparation.create({data:{id:'pending-preparation',merchantId:'store-a',campaignId:'campaign-a',intentDigest:'a'.repeat(64),campaignDigest:'b'.repeat(64),requestedBy:'owner-a',requestedImages:1}});
    await f.sql.query("DELETE FROM merchants WHERE id='store-a'");await assert.rejects(f.first.read('store-a',sending.id),{code:'campaign_notice_not_found'});await assert.rejects(f.first.startDispatch(sending),{code:'campaign_notice_not_found'});assert.deepEqual((await f.prisma.merchantNotification.findMany()).map(row=>row.id),['legacy-inbox']);assert.deepEqual((await f.prisma.whatsAppDelivery.findMany()).map(row=>row.id),['legacy-delivery']);assert.equal((await f.second.read('store-b',other.id)).merchantId,'store-b');
    assert.equal(await f.prisma.metaAdsCampaignPreparation.count({where:{merchantId:'store-a'}}),0);assert.equal(await f.prisma.metaAdsCampaignNoticeContact.count({where:{merchantId:'store-a'}}),0);
  }finally{await f.close();}
});
test('ACAP-17 foreign store access and unsafe review links do not create an inbox',async()=>{
  const f=await fixture();try{const notice=await f.first.admit(f.input);await assert.rejects(f.second.read('store-b',notice.id),{code:'campaign_notice_not_found'});await assert.rejects(f.second.ensureInbox('store-b',notice.id,f.inbox),{code:'campaign_notice_not_found'});await assert.rejects(f.first.ensureInbox('store-a',notice.id,{...f.inbox,reviewUrl:'https://secret@dashboard.example.test/#meta-ads-agent'}),{code:'campaign_notice_review_url_invalid'});assert.equal(await f.prisma.merchantNotification.count(),0);}finally{await f.close();}
});
