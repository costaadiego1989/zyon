import assert from "node:assert/strict";
import test from "node:test";
import {createCampaignFixture} from "../../../../../tests/prospect-campaign-fixture.js";
import {PrismaProspectMetaInbox} from "../../infrastructure/conversations/prisma-prospect-meta-inbox.js";
import {PrismaProspectConversationRepository} from "../../infrastructure/conversations/prisma-prospect-conversation.repository.js";
import {PrismaProspectPrivacyRepository} from "../../infrastructure/crm/prisma-prospect-privacy.repository.js";
import {ProcessProspectInbound} from "./process-prospect-inbound.service.js";

import {PrismaCampaignRepository} from "../../infrastructure/campaigns/prisma-campaign.repository.js";
import {MetaProspectingSenderAdapter} from "../../infrastructure/campaigns/meta-prospecting-sender.adapter.js";
async function fixture(){
 const f=await createCampaignFixture();const inbox=new PrismaProspectMetaInbox(f.prisma,f.keys);
 await f.prisma.platformProspectSenderBinding.update({where:{id:"sender"},data:{grantedAssets:{businessId:"business1"}}});
 const worker=new ProcessProspectInbound(new PrismaProspectConversationRepository(f.prisma));
 const change=(message:Record<string,unknown>)=>({appId:"app",wabaId:"waba",phoneNumberId:"phone",value:{messages:[message]}});
 const put=async(id:string,body:string,timestamp?:string,address:Record<string,string>={from:f.endpoint.normalizedValue!})=>{
   await inbox.accept(change({id,type:"text",text:{body},timestamp,...address}));
   const row=await f.prisma.prospectInboxEvent.findFirstOrThrow({where:{eventId:id}});return row.id;
 };
 const chat=()=>f.prisma.prospectConversation.findFirstOrThrow();
 return {...f,inbox,worker,put,change,chat};
}
test("PROS-09 AC2 shared unconfirmed businesses stay ambiguous after a customer reply",async()=>{
 const f=await fixture();try{
  const other=await f.prisma.platformProspect.create({data:{cnpj:"11222333000181",sourceSnapshotId:"search-old"}});
  await f.prisma.prospectContactBinding.updateMany({data:{confirmationState:"unconfirmed"}});
  await f.prisma.prospectContactBinding.create({data:{prospectId:other.id,endpointId:f.endpoint.id}});
  await f.worker.process(await f.put("ambiguous","yes","1700000000"));const c=await f.chat();
  assert.equal(c.prospectId,null);assert.deepEqual(c.ambiguousBindings.sort(),[f.lead.id,other.id].sort());assert.equal(await f.prisma.platformProspect.count({where:{stage:"responded"}}),0);
 }finally{await f.close();}
});
test("PROS-13 AC4 only valid customer time opens exactly 24h of free response",async()=>{
 const f=await fixture();try{
  await f.worker.process(await f.put("undated","first"));assert.equal((await f.chat()).serviceWindowEndsAt,null);
  await f.worker.process(await f.put("dated","second","1700000000"));assert.equal((await f.chat()).serviceWindowEndsAt?.getTime(),1700000000000+86400000);
  await f.worker.process(await f.put("future","invalid","9999999999"));assert.equal((await f.chat()).serviceWindowEndsAt?.getTime(),1700000000000+86400000);
 }finally{await f.close();}
});
test("PROS-15 AC2 replay across processors creates one inbound message and one durable AI job",async()=>{
 const f=await fixture();try{
  await f.put("one","interest",String(Math.floor(Date.now()/1000)-60));const id=(await f.prisma.prospectInboxEvent.findFirstOrThrow()).id;
  await Promise.all([f.worker.process(id),f.worker.process(id)]);
  assert.equal(await f.prisma.prospectMessage.count(),1);assert.equal(await f.prisma.prospectOutbox.count({where:{kind:"prospect.ai.reply"}}),1);
  assert.equal((await f.chat()).lastSequence,1);assert.equal((await f.prisma.prospectInboxEvent.findUniqueOrThrow({where:{id}})).state,"processed");
 }finally{await f.close();}
});
test("PROS-16 AC2 latest customer preview uses timestamp and event ID, follows verified phone to BSUID and cancels follow-up",async()=>{
 const f=await fixture();try{
  await f.prisma.prospectSequence.create({data:{senderBindingId:"sender",endpointId:f.endpoint.id,followUpDueAt:new Date()}});
  await f.worker.process(await f.put("a","earlier","1700000000",{from:f.endpoint.normalizedValue!,from_user_id:"Case.Abc"}));
  await f.worker.process(await f.put("z","later","1700000000",{from_user_id:"Case.Abc"}));
  const c=await f.chat();assert.equal(await f.prisma.prospectConversation.count(),1);assert.equal(c.endpointId,f.endpoint.id);assert.equal(c.lastInboundPreview,"later");assert.equal(c.lastInboundEventId,"z");
  assert.equal((await f.prisma.prospectSequence.findFirstOrThrow()).followUpDueAt,null);assert.equal((await f.prisma.platformProspect.findFirstOrThrow()).lastReplyPreview,"later");
  await assert.rejects(f.inbox.accept({...f.change({from_user_id:"Case.Abc",id:"foreign"}),wabaId:"wrong"}),/sender_identity_mismatch/);
 }finally{await f.close();}
});
test("PROS-16 AC3 late messages cannot regress a customer preview and explicit refusal invalidates queued work",async()=>{
 const f=await fixture();try{
  await f.worker.process(await f.put("new","recent","1700000090"));await f.worker.process(await f.put("old","old","1700000000"));
  assert.equal((await f.chat()).lastInboundPreview,"recent");assert.equal((await f.chat()).lastInboundEventId,"new");assert.equal((await f.chat()).lastSequence,2);
  await f.worker.process(await f.put("stop","PARE","1700000100"));assert.ok(await f.prisma.contactSuppression.count()>0);assert.equal(await f.prisma.prospectOutbox.count({where:{kind:"prospect.ai.reply",state:"pending"}}),0);
 }finally{await f.close();}
});
test("PROS-09 AC2 unlinked inbound content expires after inactivity without creating a CNPJ",async()=>{
 const f=await fixture();try{
  const count=await f.prisma.platformProspect.count();await f.worker.process(await f.put("unknown","private","1700000000",{from_user_id:"unknown.opaque"}));const c=await f.chat();
  const privacy=new PrismaProspectPrivacyRepository(f.prisma,f.directory,f.keys);
  await privacy.retain(new Date(Date.now()+181*86400000),10);
  assert.equal((await f.prisma.prospectMessage.findFirstOrThrow({where:{conversationId:c.id}})).content,null);
  assert.equal((await f.prisma.prospectEndpoint.findUniqueOrThrow({where:{id:c.endpointId}})).normalizedValue,null);
  assert.deepEqual((await f.prisma.prospectInboxEvent.findFirstOrThrow({where:{eventId:"unknown"}})).payload,{redacted:true});assert.equal(await f.prisma.platformProspect.count(),count);
 }finally{await f.close();}
});

test("PROS-16 AC2 trusted status or matching HTTP address links BSUID-only reply to the original phone conversation",async()=>{
 for(const source of ["status","http"]){
  const f=await fixture();try{
   const repo=new PrismaCampaignRepository(f.prisma,f.keys,f.quote);
   const packet=await repo.reserveAttempt(f.recipient.id,"worker",new Date());assert.ok(packet);
   await repo.markSubmitting(packet.attempt.id,"worker",new Date());
   if(source==="status"){
    await f.inbox.accept({appId:"app",wabaId:"waba",phoneNumberId:"phone",value:{statuses:[{id:"wamid.out",status:"read",timestamp:"1700000000",recipient_user_id:"Scoped.X",biz_opaque_callback_data:packet.attempt.id}]}});
    await f.worker.process((await f.prisma.prospectInboxEvent.findFirstOrThrow()).id);
   }else{
    const binding={id:"sender",appId:"app",wabaId:"waba",phoneNumberId:"123",displayPhoneNumber:"phone",version:1,authorizationVersion:1,connectedBy:"operator",connectedAt:new Date().toISOString()};
    const transport=new MetaProspectingSenderAdapter({credential:async()=>({binding,businessId:"business1",accessToken:"fixture"})},async()=>Response.json({messages:[{id:"wamid.out"}],contacts:[{input:packet.normalizedEndpoint,user_id:"Scoped.X"}]}));
    const result=await transport.send(packet,binding);assert.deepEqual(result.state==="provider_accepted"&&result.confirmedBsuid,{businessScope:"business1",value:"Scoped.X"});
    await repo.recordResult(packet.attempt.id,"worker",result);
   }
   await f.worker.process(await f.put("reply","correct thread","1700000010",{from_user_id:"Scoped.X"}));
   assert.equal(await f.prisma.prospectConversation.count(),1);assert.equal((await f.chat()).endpointId,f.endpoint.id);assert.equal((await f.chat()).lastInboundPreview,"correct thread");
  }finally{await f.close();}
 }
});
