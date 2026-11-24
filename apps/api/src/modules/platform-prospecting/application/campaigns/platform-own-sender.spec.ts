import assert from "node:assert/strict";
import {test} from "node:test";
import {PlatformMetaAuthorization} from "../../infrastructure/campaigns/platform-meta-authorization.js";

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
