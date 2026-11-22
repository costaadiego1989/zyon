import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import {createHmac} from "node:crypto";
import {Module} from "@nestjs/common";
import {NestFactory} from "@nestjs/core";
import {WhatsAppWebhookController} from "./whatsapp-webhook.controller.js";
import {WHATSAPP_CONFIG_REPOSITORY} from "../../domain/ports/whatsapp-config-repository.port.js";
import {AcceptBubbleWhatsWebhookUseCase} from "../../application/use-cases/accept-bubblewhats-webhook.use-case.js";
import {WhatsAppDeliveryService} from "../../application/services/whatsapp-delivery.service.js";
import {HandleStatusUpdateUseCase} from "../../application/use-cases/handle-status-update.use-case.js";
import {FISCAL_DELIVERY_DISPATCH} from "../../../../shared/integrations/fiscal-delivery-dispatch.port.js";
import {PROSPECT_META_DISPATCH} from "../../../../shared/integrations/prospect-meta-dispatch.port.js";
import {PrismaProspectMetaInbox} from "../../../platform-prospecting/infrastructure/conversations/prisma-prospect-meta-inbox.js";
import {createCampaignFixture} from "../../../../../tests/prospect-campaign-fixture.js";

const timestamp=String(Math.floor(Date.now()/1000)-60);
const platform={field:"messages",value:{metadata:{phone_number_id:"phone"},contacts:[{user_id:"Opaque.Abc"}],messages:[{id:"msg-a",from_user_id:"Opaque.Abc",timestamp,type:"text",text:{body:"hello"}}]}};
const merchant={field:"messages",value:{metadata:{phone_number_id:"shop"},statuses:[{id:"receipt",status:"read"}],messages:[{id:"shop-msg",from:"5511999999999",type:"text",text:{body:"cart"}}]}};
async function fixture(){
 const f=await createCampaignFixture();
 try{
  await f.prisma.platformProspectSenderBinding.update({where:{id:"sender"},data:{grantedAssets:{businessId:"scope"}}});
  const env={META_APP_SECRET:"test-merchant",META_APP_ID:"app",PROSPECTING_META_APP_ID:"app",PROSPECTING_META_APP_SECRET:"test-platform",PROSPECTING_META_WEBHOOK_VERIFY_TOKEN:"test-verify",PROSPECTING_META_PHONE_NUMBER_ID:"phone"};
  const saved=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
  await f.pg.query("CREATE TABLE routed(kind text, value text)");
  const record=(kind:string,value:string)=>f.pg.query("INSERT INTO routed VALUES ($1,$2)",[kind,value]);
  const route=new PrismaProspectMetaInbox(f.prisma,f.keys);
  @Module({controllers:[WhatsAppWebhookController],providers:[
   {provide:PROSPECT_META_DISPATCH,useValue:route},
   {provide:WHATSAPP_CONFIG_REPOSITORY,useValue:{findByMetaPhoneNumberId:async(id:string)=>id==="shop"?{id:"config",merchantId:"merchant",provider:"META_CLOUD",enabled:true}:null}},
   {provide:AcceptBubbleWhatsWebhookUseCase,useValue:{messageForAuthenticatedConfig:(_:unknown,provider:string,id:string)=>record(provider,id)}},
   {provide:WhatsAppDeliveryService,useValue:{reconcileMeta:()=>record("delivery","receipt")}},
   {provide:HandleStatusUpdateUseCase,useValue:{receiveMetaReceipt:()=>record("status","receipt")}},
   {provide:FISCAL_DELIVERY_DISPATCH,useValue:{fromMeta:(id:string)=>record("fiscal",id)}}
  ]}) class FixtureModule{}
  const app=await NestFactory.create(FixtureModule,{rawBody:true,logger:false});await app.listen(0,"127.0.0.1");const base=(await app.getUrl())+"/webhooks/whatsapp/";
  const post=(changes:unknown[],secret=env.META_APP_SECRET,path="meta")=>{const raw=JSON.stringify({entry:[{id:"waba",changes}]},null,2);return fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json","x-hub-signature-256":"sha256="+createHmac("sha256",secret).update(raw).digest("hex")},body:raw});};
  return {...f,post,base,async close(){await app.close();for(const [k,v] of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}await f.close();}};
 }catch(error){await f.close();throw error;}
}
test("PROS-15 AC1 invalid original-body signature persists nothing",async()=>{
 const f=await fixture();try{assert.equal((await f.post([platform],"invalid")).status,401);assert.equal(await f.prisma.prospectInboxEvent.count(),0);assert.equal((await f.pg.query("SELECT * FROM routed")).rowCount,0);}
 finally{await f.close();}
});
test("PROS-15 AC3 platform inbox commits, scopes opaque IDs, rejects divergent replay and reports storage failure",async()=>{
 const f=await fixture();try{
  const path="meta-platform";assert.equal((await fetch(f.base+path+"?hub.mode=subscribe&hub.verify_token=test-verify&hub.challenge=abc")).status,200);
  for(let n=0;n<2;n++)assert.equal((await f.post([platform],"test-platform",path)).status,200);
  const rows=await f.prisma.prospectInboxEvent.findMany();assert.equal(rows.length,1);assert.equal(rows[0].state,"pending");
  const endpoint=await f.prisma.prospectEndpoint.findFirstOrThrow({where:{identityKind:"bsuid"}});
  assert.equal(endpoint.normalizedValue,"Opaque.Abc");assert.equal(endpoint.businessScope,"scope");assert.ok(rows[0].resourceIds.includes(endpoint.id));
  const changed=structuredClone(platform);changed.value.messages[0].text.body="other";assert.equal((await f.post([changed],"test-platform",path)).status,409);
  await f.pg.query("ALTER TABLE prospect_inbox_events RENAME TO held_inbox");
  assert.equal((await f.post([platform],"test-platform",path)).status,503);assert.equal((await f.pg.query("SELECT * FROM routed")).rowCount,0);
 }finally{await f.close();}
});
test("PROS-15 AC4 mixed changes persist both platform and merchant/fiscal routing effects",async()=>{
 const f=await fixture();try{
  assert.equal((await f.post([platform,merchant])).status,200);assert.equal(await f.prisma.prospectInboxEvent.count(),1);
  assert.deepEqual((await f.pg.query("SELECT kind,value FROM routed ORDER BY kind")).rows,[{kind:"META",value:"shop-msg"},{kind:"delivery",value:"receipt"},{kind:"fiscal",value:"shop"},{kind:"status",value:"receipt"}]);
 }finally{await f.close();}
});
