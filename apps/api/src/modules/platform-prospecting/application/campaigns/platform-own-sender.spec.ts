import assert from "node:assert/strict";
import {test,mock} from "node:test";
import {PlatformMetaAuthorization} from "../../infrastructure/campaigns/platform-meta-authorization.js";
import {PlatformSenderOnboardingService} from "./platform-sender-onboarding.service.js";
import {PrismaSenderBindingRepository} from "../../infrastructure/campaigns/prisma-sender-binding.repository.js";
import {createProspectCrmFixture} from "../../../../../tests/prospect-crm-fixture.js";
import {decryptPii} from "../../../../shared/crypto/pii-cipher.service.js";
import {PrismaSenderObservationStore} from "../../infrastructure/campaigns/prisma-sender-observation.store.js";
import {MetaSenderHealthReader} from "../../infrastructure/campaigns/meta-sender-health.reader.js";
import {SenderReadinessService} from "./sender-readiness.service.js";

const ownConfig={appId:"11",configId:"12",businessId:"13",phoneNumberId:"14",wabaId:"15",systemUserId:"16",systemUserAccessToken:"own-dedicated-test-token",appSecret:"own-fixture-secret",encryptionKey:"a".repeat(64)};
function provider(){
 const bodies:Record<string,any>={
  debug_token:{data:{is_valid:true,app_id:"11",type:"SYSTEM_USER",user_id:"16",expires_at:0,scopes:["business_management","whatsapp_business_management","whatsapp_business_messaging"]}},
  me:{id:"16",business:{id:"13"}},
  "13/owned_apps":{data:[{id:"11"}]},
  "15":{id:"15",owner_business_info:{id:"13"}},
  "15/phone_numbers":{data:[{id:"14",display_phone_number:"+55 21 97119-1446",status:"CONNECTED",platform_type:"CLOUD_API"}]},
  "15/subscribed_apps":{data:[{whatsapp_business_api_data:{id:"11"}}]},
 };
 const calls:{path:string;method:string}[]=[];
 const fetcher:typeof fetch=async(input,init)=>{
  const url=new URL(String(input));assert.equal(url.origin,"https://graph.facebook.com");
  const path=url.pathname.replace(/^\/v27\.0\//,"");calls.push({path,method:init?.method??"GET"});
  assert.ok(path in bodies,path);return Response.json(bodies[path]);
 };
 return {bodies,calls,fetcher,auth:()=>new PlatformMetaAuthorization(ownConfig,fetcher)};
}

test("OWN-SENDER AC1 verifies the owned system user, app, portfolio and registered phone without OAuth or registration writes",async()=>{
 const p=provider();const asset=await p.auth().authorizeSystemUser();
 assert.deepEqual(asset,{accessToken:ownConfig.systemUserAccessToken,wabaId:"15",phoneNumberId:"14",whatsappNumber:"+5521971191446",phoneRegistered:true,tokenExpiresAt:undefined});
 assert.deepEqual(p.calls.map(x=>x.path),["debug_token","me","13/owned_apps","15","15/phone_numbers"]);
 assert.equal(p.calls.every(x=>x.method==="GET"),true);
});

test("OWN-SENDER AC1 rejects foreign revoked expired incomplete and unregistered system-user grants",async()=>{
 const faults=[
  (b:Record<string,any>)=>b.debug_token.data.is_valid=false,
  (b:Record<string,any>)=>b.debug_token.data.app_id="99",
  (b:Record<string,any>)=>b.debug_token.data.type="USER",
  (b:Record<string,any>)=>b.debug_token.data.user_id="99",
  (b:Record<string,any>)=>b.debug_token.data.expires_at=1,
  (b:Record<string,any>)=>b.debug_token.data.data_access_expires_at=1,
  (b:Record<string,any>)=>b.debug_token.data.scopes=["business_management","whatsapp_business_management"],
  (b:Record<string,any>)=>b.debug_token.data.granular_scopes=[{scope:"whatsapp_business_messaging",target_ids:["99"]}],
  (b:Record<string,any>)=>b.me.business.id="99",
  (b:Record<string,any>)=>b.me.id="99",
  (b:Record<string,any>)=>b["13/owned_apps"].data=[{id:"99"}],
  (b:Record<string,any>)=>b["15"].owner_business_info.id="99",
  (b:Record<string,any>)=>b["15/phone_numbers"].data[0].id="99",
  (b:Record<string,any>)=>b["15/phone_numbers"].data[0].platform_type="ON_PREMISE",
  (b:Record<string,any>)=>b["15/phone_numbers"].data[0].status="PENDING",
 ];
 for(const fault of faults){const p=provider();fault(p.bodies);await assert.rejects(p.auth().authorizeSystemUser(),/sender_identity_mismatch|sender_registration_required/);assert.equal(p.calls.every(x=>x.method==="GET"),true);}
 for(const field of ["businessId","phoneNumberId","wabaId","systemUserId","systemUserAccessToken"]){
  const p=provider();await assert.rejects(new PlatformMetaAuthorization({...ownConfig,[field]:""},p.fetcher).authorizeSystemUser(),/sender_unavailable/);assert.equal(p.calls.length,0);
 }
});

const actor={operatorId:"operator",correlationId:"own-sender"};
async function ownFixture(){const f=await createProspectCrmFixture(),p=provider(),store=new PrismaSenderBindingRepository(f.prisma,ownConfig.encryptionKey);return {...f,...p,store,service:new PlatformSenderOnboardingService(ownConfig,store,p.auth())};}

test("OWN-SENDER AC2 preview and confirmation persist only the separate encrypted credential with durable operator audit and exact replay",async()=>{
 const f=await ownFixture();try{
  const preview=await f.service.signupState(actor,"own-preview");
  assert.equal(preview.authorizationMethod,"system_user");assert.deepEqual(preview.existingSender,{businessId:"13",wabaId:"15",phoneNumberId:"14",displayPhoneNumber:"+5521971191446"});
  assert.equal(JSON.stringify(preview).includes(ownConfig.systemUserAccessToken),false);
  const command={clientRequestId:"own-confirm",state:preview.state,authorizationMethod:"system_user" as const};
  const binding=await f.service.connect(command,actor);assert.equal(binding.phoneNumberId,"14");assert.equal(binding.wabaId,"15");assert.equal(binding.connectedBy,actor.operatorId);
  const row=await f.prisma.platformProspectSenderBinding.findUniqueOrThrow({where:{id:binding.id}});
  assert.equal(decryptPii(row.encryptedCredentials,{AACP_PII_ENC_KEY:ownConfig.encryptionKey}),ownConfig.systemUserAccessToken);
  assert.deepEqual(row.grantedAssets,{configId:"12",businessId:"13",scopes:["whatsapp_business_management","whatsapp_business_messaging"],expiresAt:null,authorizationMethod:"system_user",systemUserId:"16",routingMode:"shared"});
  const calls=f.calls.length;assert.deepEqual(await f.service.connect(command,actor),binding);assert.equal(f.calls.length,calls);
  assert.equal(await f.prisma.platformProspectSenderBinding.count({where:{active:true}}),1);
  assert.equal(await f.prisma.prospectAuditEvent.count({where:{action:"sender_connected",actorOperatorId:actor.operatorId}}),1);
  assert.equal(await f.prisma.contactPermissionReceipt.count(),0);
  assert.equal(f.calls.some(x=>x.method!=="GET"||x.path==="oauth/access_token"),false);
  assert.equal(JSON.stringify(binding).includes(ownConfig.systemUserAccessToken),false);
 }finally{await f.close();}
});

test("OWN-SENDER AC2 expired foreign operator reused cross-method and payload-injected confirmations cannot replace a sender",async()=>{
 const f=await ownFixture();try{
  const command=async(id:string)=>({clientRequestId:id,state:(await f.service.signupState(actor)).state,authorizationMethod:"system_user" as const});
  await assert.rejects(f.service.connect(await command("foreign-operator"),{...actor,operatorId:"other"}),/signup_state_invalid/);
  const expired=await command("expired");await f.prisma.prospectSenderSignupState.updateMany({data:{expiresAt:new Date(0)}});await assert.rejects(f.service.connect(expired,actor),/signup_state_invalid/);
  const embedded=new PlatformSenderOnboardingService({...ownConfig,systemUserAccessToken:undefined},f.store,f.auth());
  const wrongMode={...await command("wrong-mode"),state:(await embedded.signupState(actor)).state};await assert.rejects(f.service.connect(wrongMode,actor),/signup_state_invalid/);
  for(const extra of [{code:"synthetic-code"},{phoneNumberId:"99"},{businessId:"99"},{wabaId:"99"},{authorizationMethod:"other"}])await assert.rejects(f.service.connect({...await command("injected-"+f.calls.length),...extra} as any,actor),/sender_identity_mismatch/);
  const rejected=await command("revoked-during-confirm");f.bodies.debug_token.data.is_valid=false;await assert.rejects(f.service.connect(rejected,actor),/sender_identity_mismatch/);f.bodies.debug_token.data.is_valid=true;
  await assert.rejects(f.service.connect({...rejected,clientRequestId:"reused-after-failure"},actor),/signup_state_invalid/);
  assert.equal((await f.store.binding())?.id,"sender");
  const cmd=await command("concurrent");const results=await Promise.allSettled([f.service.connect(cmd,actor),f.service.connect({...cmd,clientRequestId:"other-concurrent"},actor)]);assert.equal(results.filter(x=>x.status==="fulfilled").length,1);
  assert.equal(await f.prisma.platformProspectSenderBinding.count({where:{active:true}}),1);
 }finally{await f.close();}
});

test("OWN-SENDER AC2 actual protected HTTP confirmation rejects support operators and accepts the admin's genuine nonce",async()=>{
 const f=await ownFixture();const {createProspectingFixture}=await import("../../../../../tests/prospecting-fixture.js"),{ProspectSenderController}=await import("../../presentation/prospect-sender.controller.js"),{SenderReadinessService}=await import("./sender-readiness.service.js");
 const http=await createProspectingFixture({controllers:[ProspectSenderController],providers:[{provide:PlatformSenderOnboardingService,useValue:f.service},{provide:SenderReadinessService,useValue:{readiness:async()=>({status:"unknown"})}}]});
 try{
  await f.pg.query("INSERT INTO platform_operators VALUES ($1)",[http.operators.admin.id]);
  const req=(path:string,body:unknown,token:string)=>fetch(http.url+"/v1/platform/prospecting/sender"+path,{method:"POST",headers:{Authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify(body)});
  assert.equal((await req("/signup-state",{clientRequestId:"support-state"},http.operators.support.token)).status,403);
  const preview=await (await req("/signup-state",{clientRequestId:"http-state"},http.operators.admin.token)).json();assert.equal(preview.authorizationMethod,"system_user");
  const cmd={clientRequestId:"http-confirm",state:preview.state,authorizationMethod:"system_user"};
  assert.equal((await req("/meta/connect",cmd,http.operators.support.token)).status,403);
  const response=await req("/meta/connect",cmd,http.operators.admin.token);assert.equal(response.status,201);const binding=await response.json();assert.equal(binding.displayPhoneNumber,"+5521971191446");assert.equal(binding.connectedBy,http.operators.admin.id);
  assert.equal(JSON.stringify(binding).includes(ownConfig.systemUserAccessToken),false);
 }finally{await http.close();await f.close();}
});

test("OWN-SENDER AC7 actual runtime selects its dedicated own-business grant while external dispatch stays disabled",async()=>{
 const f=await createProspectCrmFixture(),p=provider();const {readProspectingTestConfig}=await import("../../../../../tests/prospecting-fixture.js"),{createProspectingRuntime}=await import("../../infrastructure/prospecting-runtime.js");const c=readProspectingTestConfig();const fetchMock=mock.method(globalThis,"fetch",p.fetcher);
 const runtime=createProspectingRuntime({PROSPECTING_ENABLED:"true",PROSPECTING_RUN_WORKERS:"false",PROSPECTING_DATABASE_URL:f.databaseUrl,PROSPECTING_DIRECTORY_DATABASE_URL:f.databaseUrl,PROSPECTING_NEO4J_READ_URI:c.neo4jUri,PROSPECTING_NEO4J_INGEST_URI:c.neo4jUri,PROSPECTING_NEO4J_READ_USER:c.neo4jUser,PROSPECTING_NEO4J_INGEST_USER:c.neo4jUser,PROSPECTING_NEO4J_READ_PASSWORD:c.neo4jPassword,PROSPECTING_NEO4J_INGEST_PASSWORD:c.neo4jPassword,PROSPECTING_SUPPRESSION_HMAC_KEY:"b".repeat(64),PROSPECTING_CURSOR_HMAC_KEY:"c".repeat(64),PROSPECTING_SENDER_ENCRYPTION_KEY:ownConfig.encryptionKey,PROSPECTING_PROPOSAL_SECRET:"own-sender-proposal-secret-valid-long-value",PROSPECTING_PROPOSAL_TTL_SECONDS:"600",PROSPECTING_DASHBOARD_ORIGIN:"https://app.example.test",PROSPECTING_META_APP_ID:"11",PROSPECTING_META_CONFIG_ID:"12",PROSPECTING_META_APP_SECRET:ownConfig.appSecret,PROSPECTING_META_BUSINESS_ID:"13",PROSPECTING_META_PHONE_NUMBER_ID:"14",PROSPECTING_META_WABA_ID:"15",PROSPECTING_META_SYSTEM_USER_ID:"16",PROSPECTING_META_SYSTEM_USER_ACCESS_TOKEN:ownConfig.systemUserAccessToken});
 try{const preview=await runtime.onboarding.signupState(actor,"runtime-own");assert.equal(preview.authorizationMethod,"system_user");assert.equal(preview.existingSender?.phoneNumberId,"14");assert.equal(runtime.status.config().dispatchMode,"disabled");assert.equal(runtime.status.config().ingestionEnabled,false);assert.equal(p.calls.every(x=>x.method==="GET"),true);}finally{fetchMock.mock.restore();await runtime.onModuleDestroy();await f.close();}
});

test("OWN-SENDER AC3 persisted system-user health rechecks the live scoped identity and never exposes the separate credential",async()=>{
 const f=await ownFixture();try{
  const s=await f.service.signupState(actor);const binding=await f.service.connect({clientRequestId:"health-own",state:s.state,authorizationMethod:"system_user"},actor);
  f.bodies["14"]={id:"14",status:"CONNECTED",platform_type:"CLOUD_API",quality_rating:"GREEN",whatsapp_business_manager_messaging_limit:"TIER_250",health_status:{can_send_message:"AVAILABLE",entities:Object.entries({PHONE_NUMBER:"14",WABA:"15",BUSINESS:"13",APP:"11"}).map(([entity_type,id])=>({entity_type,id,can_send_message:"AVAILABLE"}))}};
  f.bodies["15/message_templates"]={data:[{id:"own-template",name:"own_template",language:"pt_BR",category:"MARKETING",status:"APPROVED",components:[{type:"BODY",text:"Synthetic reviewed message."}]}]};
  const svc=new SenderReadinessService(new PrismaSenderObservationStore(f.prisma,ownConfig.encryptionKey),new MetaSenderHealthReader(ownConfig,f.fetcher));
  const healthy=await svc.readiness();assert.equal(healthy.status,"ready");assert.equal(healthy.binding?.id,binding.id);assert.equal(healthy.portfolioLimit,250);
  for(const fault of [(d:any)=>d.user_id="99",(d:any)=>d.is_valid=false,(d:any)=>d.type="USER",(d:any)=>d.scopes=["whatsapp_business_management"]]){
   const saved=structuredClone(f.bodies.debug_token.data);fault(f.bodies.debug_token.data);const bad=await svc.readiness();assert.notEqual(bad.status,"ready");assert.equal(bad.binding?.id,binding.id);assert.equal(JSON.stringify(bad).includes(ownConfig.systemUserAccessToken),false);f.bodies.debug_token.data=saved;
  }
  const row=await f.prisma.platformProspectSenderBinding.findUniqueOrThrow({where:{id:binding.id}});assert.equal(JSON.stringify([healthy,row.health]).includes(ownConfig.systemUserAccessToken),false);
  await f.prisma.platformProspectSenderBinding.update({where:{id:binding.id},data:{grantedAssets:{businessId:"13"}}});
  const embedded=await svc.readiness();assert.equal(embedded.status,"blocked");assert.ok(embedded.blockers.includes("permission_unavailable"));
 }finally{await f.close();}
});
