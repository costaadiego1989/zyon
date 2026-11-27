import {test} from "node:test";
import assert from "node:assert/strict";
import {MetaSenderHealthReader} from "./meta-sender-health.reader.js";
import type {PlatformSenderCredential} from "../../application/campaigns/sender-readiness.service.js";

const reason="Your display name has not been approved yet. Your message limit will increase after the display name is approved.";
function fixture(){
 const phone={id:"13",status:"CONNECTED",platform_type:"CLOUD_API",quality_rating:"GREEN",whatsapp_business_manager_messaging_limit:"TIER_250",health_status:{can_send_message:"LIMITED",entities:[
  {entity_type:"PHONE_NUMBER",id:"13",can_send_message:"LIMITED",can_receive_call_sip:"BLOCKED",additional_info:[reason],errors:[{error_code:138024}]},
  {entity_type:"WABA",id:"12",can_send_message:"AVAILABLE"},
  {entity_type:"BUSINESS",id:"14",can_send_message:"AVAILABLE"},
  {entity_type:"APP",id:"11",can_send_message:"AVAILABLE",can_receive_call_sip:"BLOCKED",errors:[{error_code:138025}]}
 ]}};
 const credential={accessToken:"local-fixture-only",businessId:"14",binding:{id:"sender",version:1,appId:"11",wabaId:"12",phoneNumberId:"13"}} as PlatformSenderCredential;
 const template={id:"approved",name:"hello",language:"pt_BR",category:"MARKETING",status:"APPROVED",components:[{type:"BODY",text:"Approved offer"}]};
 const calls:string[]=[];
 const reader=new MetaSenderHealthReader({appId:"11",appSecret:"local-secret"},async(input,init)=>{
  assert.equal(init?.method,undefined);const u=new URL(String(input)),path=u.pathname.replace(/^\/v27\.0\//,"");calls.push(path);
  if(path==="debug_token")return Response.json({data:{is_valid:true,app_id:"11",granular_scopes:["whatsapp_business_management","whatsapp_business_messaging"].map(scope=>({scope,target_ids:["12"]}))}});
  if(path==="13")return Response.json(phone);
  assert.equal(path,"12/message_templates");return Response.json({data:[template]});
 });
 return {phone,credential,calls,template,read:()=>reader.read(credential)};
}

test("HL-01 documented pending-name limit preserves exact quota and messaging health despite unrelated SIP errors",async()=>{
 const f=fixture();const result=await f.read();
 assert.deepEqual(result.blockers,[]);assert.equal(result.portfolioTier,"TIER_250");assert.equal(result.portfolioLimit,250);
 assert.deepEqual(result.entities,[{type:"PHONE_NUMBER",id:"13",status:"LIMITED",errorCodes:[138024]},{type:"WABA",id:"12",status:"AVAILABLE",errorCodes:[]},{type:"BUSINESS",id:"14",status:"AVAILABLE",errorCodes:[]},{type:"APP",id:"11",status:"AVAILABLE",errorCodes:[138025]}]);
 assert.equal(result.templates[0].status,"APPROVED");assert.equal(result.templates[0].requiresParameters,false);
 assert.deepEqual(f.calls,["debug_token","13","12/message_templates"]);
 f.phone.quality_rating="YELLOW";f.phone.whatsapp_business_manager_messaging_limit="TIER_2K";const next=await f.read();assert.deepEqual(next.blockers,[]);assert.equal(next.portfolioLimit,2000);
});

test("HL-01 missing or unrecognized limitations and blocked messaging never gain the pending-name exception",async()=>{
 const mutations=[
  (f:ReturnType<typeof fixture>)=>{f.phone.health_status.entities[0].additional_info=[];},
  (f:ReturnType<typeof fixture>)=>{f.phone.health_status.entities[0].additional_info=["Unknown policy limitation"];},
  (f:ReturnType<typeof fixture>)=>{f.phone.health_status.entities[0].additional_info=[reason,"Another limitation"];},
  (f:ReturnType<typeof fixture>)=>{f.phone.health_status.entities[0].can_send_message="BLOCKED";},
  (f:ReturnType<typeof fixture>)=>{f.phone.health_status.entities[1].can_send_message="BLOCKED";},
  (f:ReturnType<typeof fixture>)=>{f.phone.health_status.entities[2].can_send_message="LIMITED";},
  (f:ReturnType<typeof fixture>)=>{f.phone.health_status.entities[3].can_send_message="UNKNOWN";},
  (f:ReturnType<typeof fixture>)=>{f.phone.health_status.can_send_message="BLOCKED";},
  (f:ReturnType<typeof fixture>)=>{f.phone.quality_rating="RED";},
  (f:ReturnType<typeof fixture>)=>{f.phone.whatsapp_business_manager_messaging_limit="FUTURE_TIER";},
  (f:ReturnType<typeof fixture>)=>{f.phone.health_status.entities[0].errors=[{error_code:131031}];},
  (f:ReturnType<typeof fixture>)=>{f.phone.health_status.entities[0].can_receive_call_sip="AVAILABLE";},
 ];
 for(const [i,mutate] of mutations.entries()){const f=fixture();mutate(f);assert.ok((await f.read()).blockers.includes("quality_restricted"),"fault "+i);}
});

test("HL-01 quota exception does not bypass identity, registration or template requirements",async()=>{
 const foreign=fixture();foreign.phone.health_status.entities[1].id="99";assert.ok((await foreign.read()).blockers.includes("sender_identity_mismatch"));
 const disconnected=fixture();disconnected.phone.status="PENDING";assert.ok((await disconnected.read()).blockers.includes("sender_unavailable"));
 const unknown=fixture();unknown.phone.whatsapp_business_manager_messaging_limit="FUTURE_TIER";assert.ok((await unknown.read()).blockers.includes("portfolio_limit"));
 const pending=fixture();pending.template.status="PENDING";assert.ok((await pending.read()).blockers.includes("template_unavailable"));
});

test("HL-01 contradictory extra or duplicate entities cannot qualify for the finite pending-name exception",async()=>{
 for(const extra of [
  {entity_type:"PHONE_NUMBER",id:"99",can_send_message:"LIMITED",additional_info:[reason]},
  {entity_type:"PHONE_NUMBER",id:"13",can_send_message:"LIMITED",additional_info:[reason]},
  {entity_type:"APP",id:"99",can_send_message:"AVAILABLE"},
  {entity_type:"UNKNOWN_ENTITY",id:"99",can_send_message:"AVAILABLE"}
 ]){
  const f=fixture();f.phone.health_status.entities.push(extra);const result=await f.read();
  assert.ok(result.blockers.includes("quality_restricted"),JSON.stringify(extra));assert.equal(result.portfolioLimit,250);
 }
});
