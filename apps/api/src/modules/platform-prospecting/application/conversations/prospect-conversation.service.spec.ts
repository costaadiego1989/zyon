import assert from "node:assert/strict";
import test from "node:test";
import {createConversationFixture} from "../../../../../tests/prospect-conversation-fixture.js";
import {PrismaCampaignRepository} from "../../infrastructure/campaigns/prisma-campaign.repository.js";
test("PROS-17 AC1 handoff invalidates queued AI work; three ordinary replies are distinct, replay-safe and consume no automatic ordinal",async()=>{
 const f=await createConversationFixture();try{
  const seq=await f.prisma.prospectSequence.create({data:{endpointId:f.endpoint.id,senderBindingId:"sender"}});
  const ai=await f.service.prepareAi(f.c.id,{clientRequestId:"ai-before",content:"stale",expectedEpoch:0});
  const owner=await f.service.ownership(f.c.id,{action:"assume",clientRequestId:"assume",expectedEpoch:0},f.actor);
  assert.equal(owner.mode,"human");assert.equal(owner.controlEpoch,1);
  assert.equal((await f.prisma.prospectMessage.findUniqueOrThrow({where:{id:ai.id}})).state,"cancelled_before_submit");
  for(let n=1;n<=3;n++){
   const cmd={clientRequestId:"reply-"+n,content:"reply "+n,expectedEpoch:1};
   const m=await f.service.prepareManual(f.c.id,cmd,f.actor);
   assert.equal((await f.service.prepareManual(f.c.id,cmd,f.actor)).id,m.id);
   await Promise.all([f.service.dispatch(m.id),f.service.dispatch(m.id)]);
  }
  assert.deepEqual(f.captured.map(m=>m.text),["reply 1","reply 2","reply 3"]);
  assert.equal(await f.prisma.prospectMessage.count({where:{state:"provider_accepted"}}),3);assert.equal(await f.prisma.outreachAttempt.count(),0);assert.equal((await f.prisma.prospectSequence.findUniqueOrThrow({where:{id:seq.id}})).followUpCount,0);
  await assert.rejects(f.prisma.outreachAttempt.create({data:{sequenceId:seq.id,ordinal:2,clientRequestId:"bad",requestHash:"bad",senderVersion:1}}),/outreach_attempts_two_ordinals/);
 }finally{await f.close();}
});
test("PROS-17 AC2 returning ownership to AI cannot revive an old generation or erase a provider acceptance",async()=>{
 const f=await createConversationFixture();try{
  const accepted=await f.service.prepareAi(f.c.id,{clientRequestId:"accepted",expectedEpoch:0,content:"first AI"});await f.service.dispatch(accepted.id);
  const stale=await f.service.prepareAi(f.c.id,{clientRequestId:"old",expectedEpoch:0,content:"outdated"});
  await f.service.ownership(f.c.id,{action:"assume",clientRequestId:"switch1",expectedEpoch:0},f.actor);await f.service.ownership(f.c.id,{action:"release",clientRequestId:"switch2",expectedEpoch:1},f.actor);
  await assert.rejects(f.service.prepareAi(f.c.id,{clientRequestId:"late",expectedEpoch:0,content:"generated before handoff"}),/epoch_conflict/);
  await f.service.dispatch(stale.id);assert.deepEqual(f.captured.map(m=>m.text),["first AI"]);
  const history=await f.repo.history(f.c.id,{},f.actor);assert.equal(history.conversation.mode,"ai");assert.equal(history.conversation.controlEpoch,2);assert.equal(history.messages.find(m=>m.id===accepted.id)?.state,"provider_accepted");
 }finally{await f.close();}
});
test("PROS-17 AC2 conversational timeout holds its real campaign budget, stale window blocks text and replay has no new effect",async()=>{
 const f=await createConversationFixture();try{
  const auto=new PrismaCampaignRepository(f.prisma,f.keys,f.quote);const initial=await auto.reserveAttempt(f.recipient.id,"a",new Date());assert.ok(initial);
  f.control.price=7;f.control.unknown=true;
  const m=await f.service.prepareAi(f.c.id,{clientRequestId:"one",expectedEpoch:0,content:"paid reply"});await f.service.dispatch(m.id);await f.service.dispatch(m.id);
  const row=await f.prisma.prospectMessage.findUniqueOrThrow({where:{id:m.id}});assert.equal(row.state,"outcome_unknown");assert.equal(row.reservedAmount,7n);
  assert.equal((await f.prisma.prospectCampaign.findUniqueOrThrow({where:{id:f.campaign.id}})).reservedCents,32n);
  const stale=await f.service.prepareAi(f.c.id,{clientRequestId:"two",expectedEpoch:0,content:"expired"});
  await f.prisma.prospectConversation.update({where:{id:f.c.id},data:{serviceWindowEndsAt:new Date(0)}});
  await assert.rejects(f.service.dispatch(stale.id),/outside_send_window/);assert.deepEqual(f.captured.map(x=>x.id),[m.id]);
 }finally{await f.close();}
});

test("PROS-17 AC2 service replies use approved campaign funds after completion or pause, and positive unbound cost exposes a recoverable funding blocker",async()=>{
 for(const state of ["completed","paused","unbound"]){
  const f=await createConversationFixture();try{
   f.control.price=7;
   if(state!=="unbound"){
    const automatic=new PrismaCampaignRepository(f.prisma,f.keys,f.quote);
    const packet=await automatic.reserveAttempt(f.recipient.id,"worker",new Date());assert.ok(packet);
    await automatic.markSubmitting(packet.attempt.id,"worker",new Date());await automatic.recordResult(packet.attempt.id,"worker",{state:"provider_accepted",providerMessageId:"original",acceptedAt:new Date()});
    await f.prisma.prospectSequence.update({where:{id:packet.attempt.sequenceId},data:{state:"cancelled",cancelReason:"customer_replied"}});
    await f.prisma.prospectCampaign.update({where:{id:f.campaign.id},data:{state}});
   }
   await f.service.ownership(f.c.id,{clientRequestId:"own",expectedEpoch:0,action:"assume"},f.actor);
   const cmd={clientRequestId:"service-reply",content:"service",expectedEpoch:1};
   if(state==="unbound"){
    await assert.rejects(f.service.prepareManual(f.c.id,cmd,f.actor),/reply_budget_unavailable/);
    assert.equal(await f.prisma.prospectMessage.count(),0);assert.equal(await f.prisma.prospectOutbox.count(),0);
    assert.equal(await f.prisma.prospectCommand.count({where:{clientRequestId:cmd.clientRequestId}}),0);
   }else{
    const msg=await f.service.prepareManual(f.c.id,cmd,f.actor);await f.service.dispatch(msg.id);
    const campaign=await f.prisma.prospectCampaign.findUniqueOrThrow({where:{id:f.campaign.id}});
    assert.equal(campaign.state,state);assert.equal(campaign.spentCents,32n);assert.equal(campaign.reservedCents,0n);
    assert.equal(await f.prisma.outreachAttempt.count(),1);assert.equal((await f.prisma.prospectSequence.findFirstOrThrow()).state,"cancelled");assert.deepEqual(f.captured.map(m=>m.text),["service"]);
   }
  }finally{await f.close();}
 }
});
