import assert from "node:assert/strict";
import test from "node:test";
import {createCampaignFixture} from "../../../../../tests/prospect-campaign-fixture.js";
import {PrismaCampaignRepository} from "../campaigns/prisma-campaign.repository.js";
import {PrismaProspectMetaInbox} from "./prisma-prospect-meta-inbox.js";
import {PrismaProspectConversationRepository} from "./prisma-prospect-conversation.repository.js";

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
