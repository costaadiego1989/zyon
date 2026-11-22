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
