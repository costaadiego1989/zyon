import {test} from "node:test";
import assert from "node:assert/strict";
import {createProspectCrmFixture} from "../../../../../tests/prospect-crm-fixture.js";
import {encryptPii} from "../../../../shared/crypto/pii-cipher.service.js";
import {SenderReadinessService} from "./sender-readiness.service.js";
import {PrismaSenderObservationStore} from "../../infrastructure/campaigns/prisma-sender-observation.store.js";
import {MetaSenderHealthReader} from "../../infrastructure/campaigns/meta-sender-health.reader.js";
async function fixture(){
 const f=await createProspectCrmFixture();const key="d".repeat(64);
 await f.prisma.platformProspectSenderBinding.update({where:{id:"sender"},data:{appId:"11",wabaId:"12",phoneNumberId:"13",grantedAssets:{businessId:"14",expiresAt:null},encryptedCredentials:encryptPii("fixture-token",{AACP_PII_ENC_KEY:key})}});
 const obs={tier:"TIER_250",health:"AVAILABLE",quality:"GREEN",granted:true,phone:"13",text:"approved text",templateStatus:"APPROVED"};
 const fetcher:typeof fetch=async input=>{
  const u=new URL(String(input));const path=u.pathname.split("/").slice(2).join("/");
  if(path==="debug_token")return Response.json({data:{is_valid:true,app_id:"11",granular_scopes:obs.granted?["whatsapp_business_management","whatsapp_business_messaging"].map(scope=>({scope,target_ids:["12"]})):[]}});
  if(path==="13"){
   assert.ok(u.searchParams.get("fields")?.includes("whatsapp_business_manager_messaging_limit"));
   return Response.json({id:obs.phone,status:"CONNECTED",platform_type:"CLOUD_API",quality_rating:obs.quality,whatsapp_business_manager_messaging_limit:obs.tier,health_status:{can_send_message:obs.health,entities:[["PHONE_NUMBER","13"],["WABA","12"],["BUSINESS","14"],["APP","11"]].map(([entity_type,id])=>({entity_type,id,can_send_message:obs.health,errors:[{error_code:141002}]}))}});
  }
  assert.equal(path,"12/message_templates");assert.ok(u.searchParams.get("fields")?.includes("components"));assert.ok(!u.searchParams.get("fields")?.includes("revision"));
  return Response.json({data:[{id:"t1",name:"hello",language:"pt_BR",category:"MARKETING",status:obs.templateStatus,components:[{type:"BODY",text:obs.text}]}]});
 };
 const store=new PrismaSenderObservationStore(f.prisma,key);const svc=new SenderReadinessService(store,new MetaSenderHealthReader({appId:"11",appSecret:"fixture-secret"},fetcher));
 return {...f,svc,obs};
}
test("PROS-11 AC3 public readiness persists observed health, timestamp, template and portfolio tier without credentials or an invented global used count",async()=>{
 const f=await fixture();try{
  const r=await f.svc.readiness();assert.equal(r.status,"ready");assert.equal(r.portfolioLimit,250);assert.equal(r.portfolioUsed,null);assert.equal(r.templates[0].wabaId,"12");assert.match(r.templates[0].revision,/^[a-f0-9]{64}$/);
  const row=await f.prisma.platformProspectSenderBinding.findUniqueOrThrow({where:{id:"sender"}});assert.equal(row.healthUpdatedAt!.toISOString(),r.updatedAt);assert.ok(JSON.stringify(row.health).includes("AVAILABLE"));assert.ok(!JSON.stringify([row.health,r]).includes("fixture-token"));
 }finally{await f.close();}
});
test("PROS-11 AC4 foreign owner, language, category and stale content fingerprint block the selected template",async()=>{
 const f=await fixture();try{
  const [t]=(await f.svc.readiness()).templates;
  for(const change of [{wabaId:"foreign"},{language:"en"},{category:"UTILITY" as const},{revision:"stale"}])assert.ok((await f.svc.forSelection("sender",1,{...t,...change},"approved text")).includes("template_binding_mismatch"));
  f.obs.text="changed template";assert.ok((await f.svc.forSelection("sender",1,t,"changed template")).includes("template_binding_mismatch"));
 }finally{await f.close();}
});
test("PROS-13 AC1 directory-only endpoint preview has no_opt_in and the policy blocker, without creating a permission receipt",async()=>{
 const f=await fixture();try{
  const e=await f.prisma.prospectEndpoint.create({data:{senderBindingId:"sender",channel:"whatsapp",protectedLookup:"local"}});
  assert.deepEqual(await f.svc.preview("sender",e.id),{eligibility:"no_opt_in",blockers:["no_opt_in","provider_policy_blocked"]});
  assert.equal(await f.prisma.contactPermissionReceipt.count(),0);
 }finally{await f.close();}
});
test("PROS-13 AC3 unknown or restricted health, grants, templates, identity and quota block external activation",async()=>{
 const f=await fixture();try{
  for(const [change,blocker] of [[{granted:false},"permission_unavailable"],[{health:"LIMITED"},"quality_restricted"],[{quality:"RED"},"quality_restricted"],[{tier:"FUTURE_TIER"},"portfolio_limit"],[{phone:"77"},"sender_identity_mismatch"],[{templateStatus:"PAUSED"},"template_unavailable"]] as const){
    const saved={...f.obs};Object.assign(f.obs,change);const r=await f.svc.readiness();assert.equal(r.status,"blocked");assert.ok(r.blockers.some(b=>b===blocker));Object.assign(f.obs,saved);
  }
 }finally{await f.close();}
});
test("PROS-11 AC3 platform sender settings require admin and issuance replays the same operator-bound challenge without a raw state in the ledger",async()=>{
 const {createProspectingFixture}=await import("../../../../../tests/prospecting-fixture.js");
 const {PlatformSenderOnboardingService}=await import("./platform-sender-onboarding.service.js");
 const {PrismaSenderBindingRepository}=await import("../../infrastructure/campaigns/prisma-sender-binding.repository.js");
 const {PlatformMetaAuthorization}=await import("../../infrastructure/campaigns/platform-meta-authorization.js");
 const {ProspectSenderController}=await import("../../presentation/prospect-sender.controller.js");
 const config={appId:"11",configId:"12",businessId:"14",phoneNumberId:"13",appSecret:"fixture-only",encryptionKey:"d".repeat(64)};
 const f=await fixture();
 const onboarding=new PlatformSenderOnboardingService(config,new PrismaSenderBindingRepository(f.prisma,config.encryptionKey),new PlatformMetaAuthorization(config,async()=>{throw new Error("unexpected fetch");}));
 const http=await createProspectingFixture({controllers:[ProspectSenderController],providers:[{provide:SenderReadinessService,useValue:f.svc},{provide:PlatformSenderOnboardingService,useValue:onboarding}]});
 try{
  await f.pg.query("INSERT INTO platform_operators VALUES ($1)",[http.operators.admin.id]);
  const req=(path:string,body:unknown,token:string)=>fetch(http.url+"/v1/platform/prospecting/sender"+path,{method:body?"POST":"GET",headers:{Authorization:"Bearer "+token,"content-type":"application/json"},body:body?JSON.stringify(body):undefined});
  for(const [p,body] of [["",null],["/signup-state",{}],["/meta/connect",{}]] as const)assert.equal((await req(p,body,http.operators.support.token)).status,403);
  const admin=http.operators.admin.token;assert.equal((await (await req("",null,admin)).json()).status,"ready");
  const command={clientRequestId:"signup-state-http"};const first=await (await req("/signup-state",command,admin)).json();
  assert.equal(first.extras.version,"v5");assert.deepEqual(await (await req("/signup-state",command,admin)).json(),first);
  assert.equal(await f.prisma.prospectSenderSignupState.count(),1);assert.ok(!JSON.stringify(await f.prisma.prospectCommand.findMany()).includes(first.state));
  const foreign=await req("/meta/connect",{clientRequestId:"foreign",code:"private-code",state:first.state,wabaId:"12",phoneNumberId:"13",businessId:"foreign",messagingAccountIds:["12"],isOnBizApp:false},admin);
  assert.equal(foreign.status,409);assert.ok(!(await foreign.text()).includes("private-code"));
 }finally{await http.close();await f.close();}
});
test("PROS-11 AC4 only an observed parameter-free template with the reviewed body qualifies for this sender",async()=>{
 const f=await fixture();try{
  const available=await f.svc.readiness(),t=available.templates[0];
  assert.equal(t.previewText,"approved text");assert.equal(t.requiresParameters,false);
  assert.deepEqual(await f.svc.forSelection("sender",1,t,"approved text"),[]);
  assert.ok((await f.svc.forSelection("sender",1,{...t,previewText:"browser replacement"},"browser replacement")).includes("template_binding_mismatch"));
  f.obs.text="Hi {{1}}";const dynamic=(await f.svc.readiness()).templates[0];
  assert.equal(dynamic.requiresParameters,true);assert.equal(dynamic.previewText,"Hi {{1}}");
  assert.ok((await f.svc.forSelection("sender",1,dynamic,"Hi {{1}}")).includes("template_unavailable"));
 }finally{await f.close();}
});
