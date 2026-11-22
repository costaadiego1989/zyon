import assert from "node:assert/strict";
import { test } from "node:test";
import { createProspectCrmFixture } from "../../../../../tests/prospect-crm-fixture.js";
import { decryptPii } from "../../../../shared/crypto/pii-cipher.service.js";
import { PlatformSenderOnboardingService } from "./platform-sender-onboarding.service.js";
import { PrismaSenderBindingRepository } from "../../infrastructure/campaigns/prisma-sender-binding.repository.js";
import { PlatformMetaAuthorization } from "../../infrastructure/campaigns/platform-meta-authorization.js";

const config = { appId: "11", appSecret: "fixture-secret", configId: "12", businessId: "13", phoneNumberId: "14", encryptionKey: "a".repeat(64), registrationPin: "234567" };
const actor = { operatorId: "operator", correlationId: "onboard" };
const selected = { messagingAccountIds: ["15"], businessId: "13", wabaId: "15", phoneNumberId: "14", isOnBizApp: false, code: "fixture-code" };
const token = "synthetic-access-token";

async function fixture() {
  const db = await createProspectCrmFixture();
  const faults = { app: "11", account: "15", messaging: true, phone: "14", business: "13" };
  const fetcher = async (input: URL | string | Request) => {
    const url = new URL(String(input)); assert.equal(url.origin, "https://graph.facebook.com");
    const path = url.pathname.replace(/^\/v27\.0\//, "");
    const bodies: Record<string, unknown> = {
      "oauth/access_token": { access_token: token },
      debug_token: { data: { app_id: faults.app, is_valid: true, granular_scopes: ["whatsapp_business_management", ...(faults.messaging ? ["whatsapp_business_messaging"] : [])].map(scope => ({scope,target_ids:[faults.account]})) } },
      "15": { id: "15", owner_business_info: {id: faults.business} },
      "15/phone_numbers": { data: [{id: faults.phone, display_phone_number: "+55 11 99999-9999", status:"CONNECTED",platform_type:"CLOUD_API"}] },
      "15/subscribed_apps": { data:[{whatsapp_business_api_data:{id:"11"}}] },
    };
    assert.ok(path in bodies, path); return Response.json(bodies[path]);
  };
  const repo = new PrismaSenderBindingRepository(db.prisma, config.encryptionKey);
  const service = new PlatformSenderOnboardingService(config, repo, new PlatformMetaAuthorization(config, fetcher));
  async function command(request: string) { return {...selected, state:(await service.signupState(actor)).state,clientRequestId:request}; }
  return { ...db, service, repo, faults, command };
}
test("PROS-11 AC1 canonical grant is encrypted, versioned and reauthorization preserves logical endpoint history", async () => {
 const f = await fixture();
 try {
   const signup = await f.service.signupState(actor);
   assert.equal(signup.signupVersion,"v5"); assert.equal(signup.appId,"11"); assert.equal(signup.configId,"12");
   const cmd = {...selected,state:signup.state,clientRequestId:"connect"};
   const first = await f.service.connect(cmd,actor); assert.equal(first.wabaId,"15"); assert.equal(first.phoneNumberId,"14");
   assert.deepEqual(await f.service.connect(cmd,actor),first);
   const row = await f.prisma.platformProspectSenderBinding.findUniqueOrThrow({where:{id:first.id}});
   assert.equal(decryptPii(row.encryptedCredentials,{AACP_PII_ENC_KEY:config.encryptionKey}),token);
   assert.equal(JSON.stringify({row,first}).includes(token),false);
   await f.prisma.prospectEndpoint.create({data:{id:"history",senderBindingId:first.id,channel:"whatsapp",protectedLookup:"fixture"}});
   await f.prisma.prospectSequence.create({data:{endpointId:"history",senderBindingId:first.id,followUpCount:1,state:"completed"}});
   const next = await f.service.connect(await f.command("reauthorize"),actor);
   assert.equal(next.id,first.id); assert.ok(next.version>first.version); assert.equal(next.authorizationVersion,2);
   assert.equal((await f.prisma.prospectSequence.findFirstOrThrow({where:{senderBindingId:next.id}})).followUpCount,1);
   assert.equal(await f.prisma.contactPermissionReceipt.count(),0);
 } finally {await f.close();}
});
test("PROS-11 AC2 foreign portfolio, phone and business-app account cannot replace platform sender", async () => {
 const f=await fixture(); try {
   for (const change of [{businessId:"athom"},{phoneNumberId:"athom"},{isOnBizApp:true},{messagingAccountIds:["foreign"]}]) {
     await assert.rejects(f.service.connect({...await f.command("foreign"),...change},actor),/sender_identity_mismatch/);
   }
   assert.equal((await f.repo.binding())?.id,"sender");
 } finally {await f.close();}
});
test("PROS-11 AC5 state is operator-scoped, expires, cannot be reused and invalid server grants never replace binding", async () => {
 const f=await fixture(); try {
   const cmd=await f.command("one");
   await assert.rejects(f.service.connect(cmd,{...actor,operatorId:"other"}),/signup_state_invalid/);
   await f.prisma.prospectSenderSignupState.updateMany({data:{expiresAt:new Date(0)}});
   await assert.rejects(f.service.connect(cmd,actor),/signup_state_invalid/);
   for(const change of [{app:"wrong"},{messaging:false},{account:"foreign"},{business:"foreign"},{phone:"foreign"}]){
     const original={...f.faults}; Object.assign(f.faults,change);
     const bad=await f.command("bad"); await assert.rejects(f.service.connect(bad,actor),/sender_identity_mismatch/);
     Object.assign(f.faults,original); await assert.rejects(f.service.connect({...bad,clientRequestId:"replay"},actor),/signup_state_invalid/);
   }
   assert.equal((await f.repo.binding())?.id,"sender");
 } finally {await f.close();}
});
test("PROS-11 AC1 rotation to another verified platform app on the same portfolio, messaging account and phone preserves endpoint sequence",async()=>{
 const f=await fixture();try{
  const first=await f.service.connect(await f.command("original"),actor);
  const endpoint=await f.prisma.prospectEndpoint.create({data:{channel:"whatsapp",protectedLookup:"preserved",senderBindingId:first.id}});
  await f.prisma.prospectSequence.create({data:{senderBindingId:first.id,endpointId:endpoint.id,state:"completed",followUpCount:1}});
  const rotated={...config,appId:"21",appSecret:"rotated-fixture-secret"};
  let accountId="15",phoneId="14",businessId="13";
  const captured:typeof fetch=async input=>{
   const path=new URL(String(input)).pathname;
   const response:Record<string,unknown>={
    "/v27.0/oauth/access_token":{access_token:"rotated-fixture-token"},
    "/v27.0/debug_token":{data:{app_id:"21",is_valid:true,granular_scopes:["whatsapp_business_messaging","whatsapp_business_management"].map(scope=>({scope,target_ids:[accountId]}))}},
    ["/v27.0/"+accountId]:{id:accountId,owner_business_info:{id:businessId}},
    ["/v27.0/"+accountId+"/phone_numbers"]:{data:[{id:phoneId,display_phone_number:"+5511999999999",status:"CONNECTED",platform_type:"CLOUD_API"}]},
    ["/v27.0/"+accountId+"/subscribed_apps"]:{data:[{whatsapp_business_api_data:{id:"21"}}]}
   };assert.ok(path in response);return Response.json(response[path]);
  };
  const service=new PlatformSenderOnboardingService(rotated,f.repo,new PlatformMetaAuthorization(rotated,captured));
  const next=await service.connect({...selected,state:(await service.signupState(actor)).state,clientRequestId:"rotated"},actor);
  assert.equal(next.id,first.id);assert.equal(next.appId,"21");assert.ok(next.version>first.version);
  assert.equal((await f.prisma.prospectSequence.findUniqueOrThrow({where:{senderBindingId_endpointId:{senderBindingId:next.id,endpointId:endpoint.id}}})).followUpCount,1);
  accountId="25";phoneId="24";
  const regrouped={...rotated,phoneNumberId:phoneId};
  const moved=new PlatformSenderOnboardingService(regrouped,f.repo,new PlatformMetaAuthorization(regrouped,captured));
  const cmd={...selected,phoneNumberId:phoneId,wabaId:accountId,messagingAccountIds:[accountId],clientRequestId:"moved"};
  const transferred=await moved.connect({...cmd,state:(await moved.signupState(actor)).state},actor);
  assert.equal(transferred.id,first.id);assert.equal(transferred.phoneNumberId,"24");assert.equal(transferred.wabaId,"25");assert.ok(transferred.version>next.version);
  assert.equal((await f.prisma.prospectSequence.findFirstOrThrow({where:{senderBindingId:transferred.id}})).followUpCount,1);
  businessId="33";
  const separateConfig={...regrouped,businessId};const separate=new PlatformSenderOnboardingService(separateConfig,f.repo,new PlatformMetaAuthorization(separateConfig,captured));
  const different=await separate.connect({...cmd,state:(await separate.signupState(actor)).state,businessId,clientRequestId:"other-portfolio"},actor);
  assert.notEqual(different.id,first.id);assert.equal(await f.prisma.prospectSequence.count({where:{senderBindingId:different.id}}),0);
 }finally{await f.close();}
});
