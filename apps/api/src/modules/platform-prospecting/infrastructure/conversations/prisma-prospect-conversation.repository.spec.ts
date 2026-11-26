import assert from "node:assert/strict";
import test from "node:test";
import {createCampaignFixture} from "../../../../../tests/prospect-campaign-fixture.js";
import {PrismaCampaignRepository} from "../campaigns/prisma-campaign.repository.js";
import {PrismaProspectMetaInbox} from "./prisma-prospect-meta-inbox.js";
import {PrismaProspectConversationRepository} from "./prisma-prospect-conversation.repository.js";

async function deliveryFixture(){
 const f=await createCampaignFixture();try{
  const repo=new PrismaCampaignRepository(f.prisma,f.keys,f.quote),time=new Date();
  const packet=await repo.reserveAttempt(f.recipient.id,"worker",time);assert.ok(packet);assert.equal(await repo.markSubmitting(packet.attempt.id,"worker",time),true);
  await repo.recordResult(packet.attempt.id,"worker",{state:"provider_accepted",providerMessageId:"wamid.diagnostic",acceptedAt:time});
  const inbox=new PrismaProspectMetaInbox(f.prisma,f.keys),processor=new PrismaProspectConversationRepository(f.prisma);let tick=Math.floor(Date.now()/1000)-30;
  const receipt=async(errors:unknown,status="failed")=>{
   const raw={id:"wamid.diagnostic",status,timestamp:String(tick++),recipient_id:f.endpoint.normalizedValue!,biz_opaque_callback_data:packet.attempt.id,errors};
   const change={appId:"app",wabaId:"waba",phoneNumberId:"phone",value:{statuses:[raw]}};await inbox.accept(change);await inbox.accept(change);
   return f.prisma.prospectInboxEvent.findFirstOrThrow({where:{eventId:JSON.stringify([raw.id,status,raw.timestamp])}});
  };
  return {...f,repo,packet,inbox,processor,receipt,time};
 }catch(error){await f.close();throw error;}
}

test("DELERR AC1 persists only safe numeric failure codes and excludes provider text and ordinary events",async()=>{
 const f=await deliveryFixture();try{
  const cases=[
   {errors:[{code:131026,error_subcode:2494065,message:"PRIVATE_ERROR_TEXT",error_data:{details:"PRIVATE_ERROR_TEXT"},fbtrace_id:"PRIVATE_ERROR_TEXT"}],expected:{code:131026,subcode:2494065}},
   {errors:[null,{code:"131026"},{code:131049,error_subcode:"bad"}],expected:{code:131049}},
   {errors:[{code:10.5},{code:Number.MAX_SAFE_INTEGER+1}],expected:null},
   {errors:{code:131026},expected:null},
   {errors:[],expected:null},
  ];
  for(const item of cases){const event=await f.receipt(item.errors);assert.deepEqual((event.payload as any).providerError,item.expected);assert.equal(JSON.stringify(event.payload).includes("PRIVATE_ERROR_TEXT"),false);}
  const success=await f.receipt([{code:131026}],"delivered");assert.equal((success.payload as any).providerError,undefined);
  await f.inbox.accept({appId:"app",wabaId:"waba",phoneNumberId:"phone",value:{messages:[{id:"inbound.diagnostic",from:f.endpoint.normalizedValue!,text:{body:"hi"},errors:[{code:131026}]}]}});
  const inbound=await f.prisma.prospectInboxEvent.findFirstOrThrow({where:{eventKind:"inbound"}});assert.equal((inbound.payload as any).providerError,undefined);
 }finally{await f.close();}
});

test("DELERR AC2 durable numeric failures preserve acceptance, conservative cost and replay without retry",async()=>{
 const f=await deliveryFixture();try{
  for(const [errors,expected] of [[[{code:131026,error_subcode:123}],"provider_delivery_failed_code_131026_subcode_123"],[[{code:131049}],"provider_delivery_failed_code_131049"],[[],"provider_delivery_failed"]] as const){
   const event=await f.receipt(errors);await f.processor.processStatus(event.id);await f.processor.processStatus(event.id);
   const message=await f.prisma.prospectMessage.findFirstOrThrow({where:{attemptId:f.packet.attempt.id}});assert.equal(message.errorCode,expected);assert.equal(message.state,"provider_accepted");assert.equal(message.providerId,"wamid.diagnostic");assert.equal(message.acceptedAt?.toISOString(),f.time.toISOString());assert.equal(message.deliveredAt,null);assert.equal(message.readAt,null);
   const attempt=await f.prisma.outreachAttempt.findUniqueOrThrow({where:{id:f.packet.attempt.id}});assert.equal(attempt.state,"provider_accepted");assert.equal(attempt.providerMessageId,"wamid.diagnostic");assert.equal(attempt.acceptedAt?.toISOString(),f.time.toISOString());assert.equal(attempt.costState,"committed");assert.equal(attempt.deliveredAt,null);assert.equal(attempt.readAt,null);
   const campaign=await f.prisma.prospectCampaign.findUniqueOrThrow({where:{id:f.campaign.id}});assert.equal(campaign.spentCents,25n);assert.equal(campaign.reservedCents,0n);
   assert.equal(await f.repo.reserveAttempt(f.recipient.id,"retry",new Date()),null);assert.equal(await f.prisma.outreachAttempt.count(),1);assert.equal(await f.prisma.prospectMessage.count(),1);assert.equal((await f.prisma.prospectInboxEvent.findUniqueOrThrow({where:{id:event.id}})).state,"processed");
  }
 }finally{await f.close();}
});

test("PROS-16 AC1 read before HTTP acceptance records confirmed first delivery, one timeline message and one financial commitment",async()=>{
 const f=await createCampaignFixture();try{
  const repo=new PrismaCampaignRepository(f.prisma,f.keys,f.quote);
  const now=new Date(Date.now()-600000);const packet=await repo.reserveAttempt(f.recipient.id,"worker",now);assert.ok(packet);
  assert.equal(await repo.markSubmitting(packet.attempt.id,"worker",now),true);
  const receiptAt=new Date(Math.floor(now.getTime()/1000)*1000+5000);
  const inbox=new PrismaProspectMetaInbox(f.prisma,f.keys);
  const change={appId:"app",wabaId:"waba",phoneNumberId:"phone",value:{statuses:[{id:"wamid.early",status:"read",timestamp:String(receiptAt.getTime()/1000),recipient_id:f.endpoint.normalizedValue,biz_opaque_callback_data:packet.attempt.id}]}};
  await inbox.accept(change);const event=await f.prisma.prospectInboxEvent.findFirstOrThrow();
  const conversations=new PrismaProspectConversationRepository(f.prisma);await conversations.processStatus(event.id);await conversations.processStatus(event.id);
  await repo.recordResult(packet.attempt.id,"worker",{state:"provider_accepted",providerMessageId:"wamid.early",acceptedAt:now});
  const a=await f.prisma.outreachAttempt.findUniqueOrThrow({where:{id:packet.attempt.id}});assert.equal(a.state,"read");
  assert.equal(a.deliveredAt?.toISOString(),receiptAt.toISOString());assert.equal(a.readAt?.toISOString(),receiptAt.toISOString());assert.equal(a.acceptedAt?.toISOString(),now.toISOString());
  const lead=await f.prisma.platformProspect.findUniqueOrThrow({where:{id:f.lead.id}});assert.equal(lead.firstDeliveredAt?.toISOString(),receiptAt.toISOString());assert.equal(lead.firstAttemptAt?.toISOString(),now.toISOString());
  const c=await f.prisma.prospectCampaign.findUniqueOrThrow({where:{id:f.campaign.id}});assert.equal(c.spentCents,25n);assert.equal(c.reservedCents,0n);
  const messages=await f.prisma.prospectMessage.findMany();assert.equal(messages.length,1);assert.equal(messages[0].state,"read");assert.equal(messages[0].content,"synthetic offer");
  const conv=await f.prisma.prospectConversation.findFirstOrThrow();assert.equal(conv.lastSequence,1);assert.equal(conv.serviceWindowEndsAt,null);assert.equal(conv.lastInboundPreview,null);
 }finally{await f.close();}
});
test("PROS-16 AC1 ordinary reply identities persist independent of the two automatic ordinals",async()=>{
 const f=await createCampaignFixture();try{
  const conversation=await f.prisma.prospectConversation.create({data:{endpointId:f.endpoint.id,prospectId:f.lead.id}});
  const seq=await f.prisma.prospectSequence.create({data:{endpointId:f.endpoint.id,senderBindingId:"sender"}});
  for(let n=1;n<=3;n++)await f.prisma.prospectMessage.create({data:{conversationId:conversation.id,sequence:n,authorType:"operator",direction:"outbound",senderBindingId:"sender",state:"prepared",clientRequestId:"reply"+n,controlEpoch:0,senderVersion:1,content:"message "+n}});
  assert.equal(await f.prisma.prospectMessage.count(),3);assert.equal(await f.prisma.outreachAttempt.count(),0);assert.equal(await f.prisma.prospectSequence.count(),1);
  await assert.rejects(f.prisma.outreachAttempt.create({data:{sequenceId:seq.id,ordinal:2,clientRequestId:"third",requestHash:"hash",senderVersion:1}}),/outreach_attempts_two_ordinals/);
 }finally{await f.close();}
});

test("PROS-16 AC1 an authenticated receipt settles a legacy unknown attempt after erasure without restoring its private content",async()=>{
 const f=await createCampaignFixture();try{
  const prior=new Date(Date.now()-181*86400000),day=prior.toISOString().slice(0,10);
  await f.prisma.platformProspect.update({where:{id:f.lead.id},data:{lastBusinessActivityAt:prior}});
  const seq=await f.prisma.prospectSequence.create({data:{senderBindingId:"sender",endpointId:f.endpoint.id}});
  const a=await f.prisma.outreachAttempt.create({data:{sequenceId:seq.id,recipientId:f.recipient.id,ordinal:0,senderVersion:1,requestHash:"history",clientRequestId:"legacy",state:"outcome_unknown",costState:"reserved",reservedAmount:25,reservationDay:day,submittedAt:prior,content:"private historical offer"}});
  await f.prisma.prospectCampaign.update({where:{id:f.campaign.id},data:{reservedCents:25}});await f.prisma.prospectCampaignDailyUsage.create({data:{campaignId:f.campaign.id,day,reservedRecipients:1}});
  const {PrismaProspectPrivacyRepository}=await import("../crm/prisma-prospect-privacy.repository.js");
  await new PrismaProspectPrivacyRepository(f.prisma,f.directory,f.keys).retain(new Date(),10);
  assert.equal((await f.prisma.prospectEndpoint.findUniqueOrThrow({where:{id:f.endpoint.id}})).normalizedValue,null);
  await new PrismaProspectMetaInbox(f.prisma,f.keys).accept({appId:"app",phoneNumberId:"phone",wabaId:"waba",value:{statuses:[{id:"wa.legacy",status:"read",timestamp:String(Math.floor(Date.now()/1000)-1),biz_opaque_callback_data:a.id}]}});
  const evt=await f.prisma.prospectInboxEvent.findFirstOrThrow();const repository=new PrismaProspectConversationRepository(f.prisma);
  await repository.processStatus(evt.id);await repository.processStatus(evt.id);
  const result=await f.prisma.outreachAttempt.findUniqueOrThrow({where:{id:a.id}});assert.equal(result.state,"read");assert.equal(result.costState,"committed");assert.equal(result.content,null);
  const money=await f.prisma.prospectCampaign.findUniqueOrThrow({where:{id:f.campaign.id}});assert.equal(money.reservedCents,0n);assert.equal(money.spentCents,25n);
  assert.equal((await f.prisma.prospectMessage.findFirstOrThrow()).content,null);assert.deepEqual((await f.prisma.prospectInboxEvent.findUniqueOrThrow({where:{id:evt.id}})).payload,{redacted:true});
  assert.equal((await f.prisma.prospectEndpoint.findUniqueOrThrow({where:{id:f.endpoint.id}})).normalizedValue,null);
 }finally{await f.close();}
});
