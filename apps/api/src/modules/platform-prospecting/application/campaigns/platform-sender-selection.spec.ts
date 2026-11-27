import assert from "node:assert/strict";
import { test } from "node:test";
import { createProspectCrmFixture } from "../../../../../tests/prospect-crm-fixture.js";
import { readProspectingTestConfig } from "../../../../../tests/prospecting-fixture.js";
import { decryptPii } from "../../../../shared/crypto/pii-cipher.service.js";
import { PlatformSenderOnboardingService } from "./platform-sender-onboarding.service.js";
import { PlatformMetaAuthorization } from "../../infrastructure/campaigns/platform-meta-authorization.js";
import { PrismaSenderBindingRepository } from "../../infrastructure/campaigns/prisma-sender-binding.repository.js";
import { createProspectingRuntime } from "../../infrastructure/prospecting-runtime.js";

const config = {appId:"11", configId:"12", appSecret:"fixture-secret", encryptionKey:"a".repeat(64), businessId:"", phoneNumberId:""};
const actor = {operatorId:"operator", correlationId:"sender-selection"};
const selected = {businessId:"13", phoneNumberId:"14", wabaId:"15", messagingAccountIds:["15"], isOnBizApp:false, code:"fixture-code"};

async function fixture(pins:Partial<typeof config> = {}) {
  const db = await createProspectCrmFixture();
  const faults = {app:"11", target:"15", business:"13", phone:"14", messaging:true};
  const calls:string[] = [];
  const fetcher:typeof fetch = async input => {
    const url = new URL(String(input));
    assert.equal(url.origin,"https://graph.facebook.com");
    const path = url.pathname.replace(/^\/v27\.0\//,""); calls.push(path);
    const bodies:Record<string,unknown> = {
      "oauth/access_token":{access_token:"selection-fixture-token"},
      debug_token:{data:{is_valid:true,app_id:faults.app,granular_scopes:["whatsapp_business_management",...(faults.messaging?["whatsapp_business_messaging"]:[])].map(scope=>({scope,target_ids:[faults.target]}))}},
      "15":{id:"15",owner_business_info:{id:faults.business}},
      "15/phone_numbers":{data:[{id:faults.phone,display_phone_number:"+55 11 99999-9999",status:"CONNECTED",platform_type:"CLOUD_API"}]},
      "15/subscribed_apps":{data:[{whatsapp_business_api_data:{id:"11"}}]},
    };
    assert.ok(path in bodies,path); return Response.json(bodies[path]);
  };
  const configured = {...config,...pins};
  const repo = new PrismaSenderBindingRepository(db.prisma,config.encryptionKey);
  let service:PlatformSenderOnboardingService;
  try { service = new PlatformSenderOnboardingService(configured,repo,new PlatformMetaAuthorization(configured,fetcher)); }
  catch(error) { await db.close(); throw error; }
  return {...db,service,repo,faults,calls,command:async(id:string)=>({...selected,state:(await service.signupState(actor)).state,clientRequestId:id})};
}

test("SENDER-CONNECT AC1 select assets during signup and persist only the provider-verified platform identity",async()=>{
  const f=await fixture();try{
    const command=await f.command("selected-number");
    const binding=await f.service.connect(command,actor);
    assert.equal(binding.phoneNumberId,"14");assert.equal(binding.wabaId,"15");
    const row=await f.prisma.platformProspectSenderBinding.findUniqueOrThrow({where:{id:binding.id}});
    assert.equal((row.grantedAssets as {businessId:string}).businessId,"13");
    assert.equal(decryptPii(row.encryptedCredentials,{AACP_PII_ENC_KEY:config.encryptionKey}),"selection-fixture-token");
    assert.equal(JSON.stringify(binding).includes("selection-fixture-token"),false);
    assert.deepEqual(await f.service.connect(command,actor),binding);
    assert.equal(f.calls.filter(path=>path==="oauth/access_token").length,1);
    assert.equal(await f.prisma.contactPermissionReceipt.count(),0);
  }finally{await f.close();}
});

test("SENDER-CONNECT AC2 selected assets cannot bypass ownership, grant, app, state or phone verification",async()=>{
  const f=await fixture();try{
    for(const [index,change] of [{app:"99"},{target:"99"},{business:"99"},{phone:"99"},{messaging:false}].entries()){
      const previous={...f.faults};Object.assign(f.faults,change);
      const command=await f.command("rejected-grant-"+index);
      await assert.rejects(f.service.connect(command,actor),/sender_identity_mismatch/);
      Object.assign(f.faults,previous);
      await assert.rejects(f.service.connect({...command,clientRequestId:"used-state-"+index},actor),/signup_state_invalid/);
    }
    await assert.rejects(f.service.connect({...await f.command("other-operator")},{...actor,operatorId:"other"}),/signup_state_invalid/);
    for(const change of [{businessId:""},{phoneNumberId:""},{businessId:"13/phone_numbers"},{isOnBizApp:true},{messagingAccountIds:["99"]}]){
      await assert.rejects(f.service.connect({...await f.command("invalid-selection-"+f.calls.length),...change},actor),/sender_identity_mismatch/);
    }
    assert.equal((await f.repo.binding())?.id,"sender");
    assert.equal(await f.prisma.platformProspectSenderBinding.count({where:{active:true}}),1);
  }finally{await f.close();}
});

test("SENDER-CONNECT AC2 configured business and phone pins continue to restrict selection",async()=>{
  for(const pins of [{businessId:"99"},{phoneNumberId:"99"}]){
    const f=await fixture(pins);try{
      await assert.rejects(f.service.connect(await f.command("pinned-selection"),actor),/sender_identity_mismatch/);
      assert.equal(f.calls.length,0);assert.equal((await f.repo.binding())?.id,"sender");
    }finally{await f.close();}
  }
});

test("SENDER-CONNECT AC3 actual runtime issues signup state before the operator selects a business and phone",async()=>{
  const f=await createProspectCrmFixture(),g=readProspectingTestConfig();
  const runtime=createProspectingRuntime({PROSPECTING_ENABLED:"true",PROSPECTING_RUN_WORKERS:"false",PROSPECTING_DATABASE_URL:f.databaseUrl,PROSPECTING_DIRECTORY_DATABASE_URL:f.databaseUrl,
    PROSPECTING_NEO4J_READ_URI:g.neo4jUri,PROSPECTING_NEO4J_INGEST_URI:g.neo4jUri,PROSPECTING_NEO4J_READ_USER:g.neo4jUser,PROSPECTING_NEO4J_INGEST_USER:g.neo4jUser,PROSPECTING_NEO4J_READ_PASSWORD:g.neo4jPassword,PROSPECTING_NEO4J_INGEST_PASSWORD:g.neo4jPassword,
    PROSPECTING_SUPPRESSION_HMAC_KEY:"b".repeat(64),PROSPECTING_CURSOR_HMAC_KEY:"c".repeat(64),PROSPECTING_SENDER_ENCRYPTION_KEY:config.encryptionKey,PROSPECTING_PROPOSAL_SECRET:"sender-selection-dedicated-proposal-secret",PROSPECTING_PROPOSAL_TTL_SECONDS:"600",PROSPECTING_DASHBOARD_ORIGIN:"https://app.example.test",
    PROSPECTING_META_APP_ID:config.appId,PROSPECTING_META_CONFIG_ID:config.configId,PROSPECTING_META_APP_SECRET:config.appSecret});
  try{
    const state=await runtime.onboarding.signupState(actor,"runtime-selection");
    assert.equal(state.appId,"11");assert.equal(state.configId,"12");assert.equal(state.signupVersion,"v5");
    assert.equal((await f.prisma.prospectSenderSignupState.count({where:{operatorId:actor.operatorId,consumedAt:null}})),1);
    assert.equal((await f.prisma.platformProspectSenderBinding.findFirstOrThrow({where:{active:true}})).id,"sender");
  }finally{await runtime.onModuleDestroy();await f.close();}
});
