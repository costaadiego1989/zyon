import assert from "node:assert/strict";
import {test} from "node:test";
import {createCampaignFixture,fixtureOffer,fixtureTemplate} from "../../../../../tests/prospect-campaign-fixture.js";
import {PrismaCampaignRepository} from "../../infrastructure/campaigns/prisma-campaign.repository.js";
import {PrismaProspectConversationRepository} from "../../infrastructure/conversations/prisma-prospect-conversation.repository.js";
import {SenderReadinessService} from "./sender-readiness.service.js";
import {ProspectDispatchWorker} from "./prospect-dispatch.worker.js";
import {ProspectFollowUpWorker} from "./prospect-follow-up.worker.js";
async function fixture(delivered=true){
 const f=await createCampaignFixture();
 const repo=new PrismaCampaignRepository(f.prisma,f.keys,()=>({amountCents:5,currency:"BRL",validUntil:new Date("2031-01-01")}));
 const c={now:new Date("2026-11-19T17:00:00Z"),timeout:false,sent:[] as string[]};
 const binding={id:"sender",version:1,appId:"app",wabaId:"waba",phoneNumberId:"phone",displayPhoneNumber:"synthetic",connectedBy:"operator",connectedAt:new Date(0).toISOString(),authorizationVersion:1};
 const health=new SenderReadinessService({credential:async()=>({binding,accessToken:"fixture",businessId:"business"}),save:async(_,h)=>{await f.prisma.platformProspectSenderBinding.update({where:{id:"sender"},data:{health:JSON.parse(JSON.stringify(h))}});return true;},permission:async()=>"opted_in"},
 {read:async()=>({entities:[],templates:[fixtureTemplate],blockers:[],portfolioLimit:100,portfolioTier:"100"})});
 const dispatch=new ProspectDispatchWorker(repo,health,{current:async()=>fixtureOffer,allowedUrl:()=>true},{async send(p){c.sent.push(p.attempt.id);if(c.timeout)throw Error("ambiguous");return {state:"provider_accepted",providerMessageId:"wa."+p.attempt.id,acceptedAt:c.now};}},()=>c.now);
 await dispatch.processRecipient(f.recipient.id);assert.equal(c.sent.length,1);
 const first=await f.prisma.outreachAttempt.findFirstOrThrow();
 if(delivered){
 const evt=await f.prisma.prospectInboxEvent.create({data:{eventId:"delivery",senderBindingId:"sender",eventKind:"status",payloadHash:"fixture",providerOccurredAt:c.now,receivedAt:c.now,payload:{endpointId:f.endpoint.id,providerId:"wa."+first.id,status:"delivered"}}});
 await new PrismaProspectConversationRepository(f.prisma).processStatus(evt.id);
 }
 const worker=new ProspectFollowUpWorker(repo,dispatch,()=>c.now);
 return {...f,repo,worker,first,c};
}
test("PROS-18 AC3 requires confirmed delivery, elapsed deadline, trusted local window and unsuppressed unanswered sequence",async()=>{
 for(const reason of ["no_delivery","reply","refused","suppressed","converted","closed","human","trusted","fallback"]){
  const f=await fixture(reason!=="no_delivery");try{
   await f.prisma.prospectEndpoint.update({where:{id:f.endpoint.id},data:{timezone:"America/New_York",timezoneSource:reason==="trusted"?"contact_confirmed":null}});
   if(reason==="reply")await f.prisma.prospectConversation.update({where:{endpointId:f.endpoint.id},data:{lastInboundAt:f.c.now,lastInboundEventId:"reply"}});
   if(reason==="human")await f.prisma.prospectConversation.update({where:{endpointId:f.endpoint.id},data:{mode:"human"}});
   if(reason==="converted")await f.prisma.platformProspect.update({where:{id:f.lead.id},data:{stage:"converted",convertedAt:f.c.now}});
   if(reason==="suppressed")await f.prisma.contactSuppression.create({data:{senderScope:"zyon_platform",protectedLookup:f.endpoint.protectedLookup,keyVersion:f.endpoint.keyVersion,reason:"opt_out",occurredAt:f.c.now}});
   if(reason==="refused"||reason==="closed")await f.prisma.prospectSequence.update({where:{id:f.first.sequenceId},data:{state:"cancelled",cancelReason:reason}});
   f.c.now=new Date("2026-11-20T17:00Z");await f.worker.poll();assert.equal(f.c.sent.length,1);
   f.c.now=new Date("2026-11-23T12:00Z");await f.worker.poll();
   assert.equal(f.c.sent.length,reason==="fallback"?2:1,reason);
   if(reason==="trusted"){const seq=await f.prisma.prospectSequence.findUniqueOrThrow({where:{id:f.first.sequenceId}});assert.equal(seq.followUpDueAt?.toISOString(),"2026-11-23T14:00:00.000Z");f.c.now=new Date("2026-11-23T14:00Z");await f.worker.poll();assert.equal(f.c.sent.length,2);}
  }finally{await f.close();}
 }
});
test("PROS-18 AC4 competing pollers and retries close a sequence at its single follow-up, including uncertain acceptance and reenrollment",async()=>{
 for(const timeout of [false,true]){
 const f=await fixture();try{
 f.c.now=new Date("2026-11-23T14:00Z");f.c.timeout=timeout;
 await Promise.all([f.worker.poll(),f.worker.poll()]);await f.worker.poll();
 const attempts=await f.prisma.outreachAttempt.findMany({orderBy:{ordinal:"asc"}});
 assert.deepEqual(f.c.sent,attempts.map(a=>a.id));assert.deepEqual(attempts.map(a=>a.ordinal),[0,1]);
 assert.equal(attempts[1].state,timeout?"outcome_unknown":"provider_accepted");assert.equal(attempts[1].reservationDay,"2026-11-23");
 const seq=await f.prisma.prospectSequence.findUniqueOrThrow({where:{id:f.first.sequenceId}});assert.equal(seq.followUpCount,1);assert.equal(seq.state,"completed");assert.equal(seq.followUpDueAt,null);
 await f.prisma.prospectCampaign.update({where:{id:f.campaign.id},data:{state:"paused"}});await f.worker.poll();await f.prisma.prospectCampaign.update({where:{id:f.campaign.id},data:{state:"running"}});
 assert.equal(await f.repo.reserveAttempt(f.recipient.id,"re-enroll",f.c.now),null);await f.worker.poll();
 assert.equal(await f.prisma.outreachAttempt.count(),2);assert.equal(f.c.sent.length,2);
 const campaign=await f.prisma.prospectCampaign.findUniqueOrThrow({where:{id:f.campaign.id}});assert.equal(campaign.reservedCents,timeout?5n:0n);
 }finally{await f.close();}}
});
