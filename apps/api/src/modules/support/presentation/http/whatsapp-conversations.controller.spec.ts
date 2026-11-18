import assert from "node:assert/strict";
import test from "node:test";
import { WhatsAppConversationsController } from "./whatsapp-conversations.controller.js";

const actor={kind:"human" as const,tenantId:"merchant-a",userId:"operator-a",email:"private@example.test",role:"staff" as const};
const request={tenantPrincipal:actor};
test("T58 conversation routes delegate only canonical principal and commands",async t=>{
  const calls:unknown[]=[];
  const controller=new WhatsAppConversationsController({list:async(...args:unknown[])=>{calls.push(["list",...args]);return{data:[]};},
    detail:async(...args:unknown[])=>{calls.push(["detail",...args]);return{messages:[]};}} as never,
    {execute:async(...args:unknown[])=>{calls.push(["claim",...args]);}} as never,
    {execute:async(...args:unknown[])=>{calls.push(["send",...args]);return{id:"message-a",ticketId:"ticket-a",senderType:"merchant",content:"Reply",createdAt:new Date().toISOString(),
      metadata:{kind:"whatsapp_outgoing",schemaVersion:1,clientMessageId:"client-original-123",delivery:{status:"queued",revision:0}}};}} as never,
    {execute:async(...args:unknown[])=>{calls.push(["close",...args]);}} as never);
  await t.test("list and detail derive tenant exclusively through the authenticated principal",async()=>{
    await controller.list(request,{});await controller.detail(request,"ticket-a",{});
    assert.deepEqual(calls.splice(0),[["list",actor,{}],["detail",actor,"ticket-a",{}]]);
  });
  await t.test("context contains only the authenticated identity and rejects attempted grants",()=>{
    assert.deepEqual(controller.context(request,{}),{merchant_id:"merchant-a",user_id:"operator-a",role:"STAFF"});
    for(const query of [{merchant_id:"foreign"},{role:"OWNER"},{credentials:"grant"}])assert.throws(()=>controller.context(request,query),/invalid_whatsapp_context_query/);
    assert.equal(calls.length,0);
  });
  await t.test("claim and close pass the original expected epoch to existing application commands",async()=>{
    const claim={expectedEpoch:1},close={expectedEpoch:2,status:"closed"};
    await controller.claimCase(request,"ticket-a",claim);await controller.closeCase(request,"ticket-a",close);
    assert.deepEqual(calls.splice(0),[["claim",actor,"ticket-a",claim],["close",actor,"ticket-a",close]]);
  });
  await t.test("send has a closed body and excludes private command state in its response",async()=>{
    const result=await controller.sendMessage(request,"ticket-a",{content:"Reply",clientMessageId:"client-original-123"});
    assert.deepEqual(calls.splice(0),[["send",{ticketId:"ticket-a",merchantId:"merchant-a",senderType:"merchant",content:"Reply",clientMessageId:"client-original-123"},{principal:actor,requiredSource:"whatsapp"}]]);
    assert.equal(result.clientMessageId,"client-original-123");assert.deepEqual(result.delivery,{status:"queued",revision:0});
    await assert.rejects(controller.sendMessage(request,"ticket-a",{content:"Reply",clientMessageId:"client-original-123",merchantId:"foreign"}),/invalid_whatsapp_message/);
    assert.equal(calls.length,0);
  });
});
