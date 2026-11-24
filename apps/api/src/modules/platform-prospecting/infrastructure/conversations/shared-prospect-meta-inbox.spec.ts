import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import {createHmac} from "node:crypto";
import {Module} from "@nestjs/common";
import {NestFactory} from "@nestjs/core";
import {createCampaignFixture} from "../../../../../tests/prospect-campaign-fixture.js";
import {PrismaProspectMetaInbox} from "./prisma-prospect-meta-inbox.js";
import {WhatsAppWebhookController} from "../../../whatsapp-channel/presentation/http/whatsapp-webhook.controller.js";
import {WHATSAPP_CONFIG_REPOSITORY} from "../../../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js";
import {AcceptBubbleWhatsWebhookUseCase} from "../../../whatsapp-channel/application/use-cases/accept-bubblewhats-webhook.use-case.js";
import {WhatsAppDeliveryService} from "../../../whatsapp-channel/application/services/whatsapp-delivery.service.js";
import {HandleStatusUpdateUseCase} from "../../../whatsapp-channel/application/use-cases/handle-status-update.use-case.js";
import {FISCAL_DELIVERY_DISPATCH} from "../../../../shared/integrations/fiscal-delivery-dispatch.port.js";
import {PROSPECT_META_DISPATCH} from "../../../../shared/integrations/prospect-meta-dispatch.port.js";

async function fixture(){
 const f=await createCampaignFixture();
 const env={META_APP_SECRET:"shared-fixture-secret",META_APP_ID:"app",META_EMBEDDED_SIGNUP_APP_ID:"app",PROSPECTING_META_APP_ID:"app",PROSPECTING_META_APP_SECRET:"shared-fixture-secret",PROSPECTING_META_PHONE_NUMBER_ID:"phone",PROSPECTING_META_SYSTEM_USER_ACCESS_TOKEN:"shared-fixture-env-only"};
 const saved=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
 let app:Awaited<ReturnType<typeof NestFactory.create>>|undefined;
 try{
  await f.prisma.platformProspectSenderBinding.update({where:{id:"sender"},data:{grantedAssets:{businessId:"scope",authorizationMethod:"system_user",routingMode:"shared",systemUserId:"16"}}});
  const conversation=await f.prisma.prospectConversation.create({data:{endpointId:f.endpoint.id,prospectId:f.lead.id}});
  await f.prisma.prospectMessage.create({data:{conversationId:conversation.id,senderBindingId:"sender",sequence:1,authorType:"operator",direction:"outbound",content:"Synthetic Zyon approach",state:"provider_accepted",providerId:"wamid.prospect.out",submittedAt:new Date()}});
  await f.pg.query("CREATE TABLE merchant_routed(kind text, provider_id text, alias text)");
  const record=(kind:string,id:string,alias:string|null=null)=>f.pg.query("INSERT INTO merchant_routed VALUES ($1,$2,$3)",[kind,id,alias]);
  const inbox=new PrismaProspectMetaInbox(f.prisma,f.keys);
  @Module({controllers:[WhatsAppWebhookController],providers:[
   {provide:PROSPECT_META_DISPATCH,useValue:inbox},
   {provide:WHATSAPP_CONFIG_REPOSITORY,useValue:{findByMetaPhoneNumberId:async(id:string)=>id==="phone"?{id:"store-channel",merchantId:"athom",provider:"META_CLOUD",enabled:true}:null}},
   {provide:AcceptBubbleWhatsWebhookUseCase,useValue:{messageForAuthenticatedConfig:(_:unknown,provider:string,id:string,payload:{fromAlias?:string})=>record(provider,id,payload.fromAlias??null)}},
   {provide:WhatsAppDeliveryService,useValue:{reconcileMeta:(_:string,__:string,s:{id:string})=>record("delivery",s.id)}},
   {provide:HandleStatusUpdateUseCase,useValue:{receiveMetaReceipt:(s:{messageId:string})=>record("status",s.messageId)}},
   {provide:FISCAL_DELIVERY_DISPATCH,useValue:{fromMeta:(_:string,statuses:{id:string}[])=>Promise.all(statuses.map(s=>record("fiscal",s.id)))}}
  ]}) class FixtureModule{}
  app=await NestFactory.create(FixtureModule,{rawBody:true,logger:false});await app.listen(0,"127.0.0.1");const base=await app.getUrl();
  const post=(value:Record<string,unknown>,secret=env.META_APP_SECRET,wabaId="waba",path="meta")=>{const raw=JSON.stringify({entry:[{id:wabaId,changes:[{field:"messages",value:{metadata:{phone_number_id:"phone"},...value}}]}]});return fetch(base+"/webhooks/whatsapp/"+path,{method:"POST",headers:{"content-type":"application/json","x-hub-signature-256":"sha256="+createHmac("sha256",secret).update(raw).digest("hex")},body:raw});};
  return {...f,inbox,post,conversation,async close(){await app!.close();for(const [k,v]of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}await f.close();}};
 }catch(error){await app?.close();for(const[k,v]of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}await f.close();throw error;}
}
const message=(id:string,from:string,context?:string)=>({id,from,type:"text",text:{body:id},...(context?{context:{id:context}}:{})});

test("OWN-SENDER AC4 signed mixed batches persist prospect events and preserve every merchant message receipt and contact name",async()=>{
 const f=await fixture();try{
  const prospect="5511999999999",buyer="5511988888888";
  const payload={contacts:[{wa_id:prospect,profile:{name:"Prospect"}},{wa_id:buyer,profile:{name:"Buyer"}}],messages:[message("prospect-reply",prospect),message("buyer-order",buyer),message("merchant-context",prospect,"wamid.store.out")],statuses:[{id:"wamid.prospect.out",status:"read",recipient_id:prospect,timestamp:"1700000000"},{id:"wamid.store.out",status:"read",recipient_id:buyer,timestamp:"1700000000"}]};
  assert.equal((await f.post(payload)).status,200);
  const events=await f.prisma.prospectInboxEvent.findMany({orderBy:{eventKind:"asc"}});assert.equal(events.length,2);assert.equal((events[0].payload as {providerId:string}).providerId,"prospect-reply");assert.equal((events[1].payload as {providerId:string}).providerId,"wamid.prospect.out");
  assert.deepEqual((await f.pg.query("SELECT kind,provider_id,alias FROM merchant_routed ORDER BY kind,provider_id")).rows,[{kind:"META",provider_id:"buyer-order",alias:"Buyer"},{kind:"META",provider_id:"merchant-context",alias:"Prospect"},{kind:"delivery",provider_id:"wamid.store.out",alias:null},{kind:"fiscal",provider_id:"wamid.store.out",alias:null},{kind:"status",provider_id:"wamid.store.out",alias:null}]);
  assert.equal(await f.prisma.prospectEndpoint.count(),1);
  assert.equal((await f.post({messages:[message("prospect-context",prospect,"wamid.prospect.out")]})).status,200);
  assert.equal(await f.prisma.prospectInboxEvent.count(),3);
 }finally{await f.close();}
});

test("OWN-SENDER AC4 unapproached CRM contacts and the period before a platform binding remain in the merchant pipeline",async()=>{
 const f=await fixture();try{
  await f.prisma.prospectMessage.deleteMany();
  assert.equal((await f.post({messages:[message("crm-only-buyer","5511999999999")]})).status,200);
  assert.equal(await f.prisma.prospectInboxEvent.count(),0);
  await f.prisma.platformProspectSenderBinding.update({where:{id:"sender"},data:{phoneNumberId:"not-the-shared-phone"}});
  assert.equal((await f.post({messages:[message("before-binding-buyer","5511988888888")]})).status,200);
  assert.deepEqual((await f.pg.query("SELECT provider_id FROM merchant_routed ORDER BY provider_id")).rows,[{provider_id:"before-binding-buyer"},{provider_id:"crm-only-buyer"}]);
 }finally{await f.close();}
});

test("OWN-SENDER AC5 invalid signature app account and divergent replay cannot change shared routing persistence",async()=>{
 const f=await fixture();try{
  const value={messages:[message("verified-prospect","5511999999999")]};
  assert.equal((await f.post(value,"bad-signature")).status,401);assert.equal(await f.prisma.prospectInboxEvent.count(),0);
  assert.equal((await f.post(value,undefined,"foreign-waba")).status,503);assert.equal(await f.prisma.prospectInboxEvent.count(),0);
  const saved=process.env.META_EMBEDDED_SIGNUP_APP_ID;process.env.META_EMBEDDED_SIGNUP_APP_ID="other-app";
  assert.equal((await f.post(value)).status,503);process.env.META_EMBEDDED_SIGNUP_APP_ID=saved;
  assert.equal((await f.post(value)).status,200);assert.equal((await f.post(value)).status,200);assert.equal(await f.prisma.prospectInboxEvent.count(),1);
  assert.equal((await f.post({messages:[{...value.messages[0],text:{body:"different body"}}]})).status,409);
  assert.equal((await f.pg.query("SELECT * FROM merchant_routed")).rowCount,0);
 }finally{await f.close();}
});

test("OWN-SENDER AC4 deactivating the shared platform binding hands buyer messages back to the merchant",async()=>{
 const f=await fixture();try{
  await f.prisma.platformProspectSenderBinding.update({where:{id:"sender"},data:{active:false}});
  assert.equal((await f.post({messages:[message("after-platform-deactivation","5511999999999")]})).status,200);
  assert.equal(await f.prisma.prospectInboxEvent.count(),0);
  assert.deepEqual((await f.pg.query("SELECT kind,provider_id FROM merchant_routed")).rows,[{kind:"META",provider_id:"after-platform-deactivation"}]);
 }finally{await f.close();}
});

test("OWN-SENDER AC5 exclusive bindings consume complete batches and preserve identical and divergent replay protection",async()=>{
 const f=await fixture();try{
  await f.prisma.platformProspectSenderBinding.update({where:{id:"sender"},data:{grantedAssets:{businessId:"scope"}}});
  const value={messages:[message("exclusive-reply","5511988888888")]};
  assert.equal((await f.post(value)).status,200);assert.equal((await f.post(value)).status,200);
  assert.equal((await f.post(value,undefined,"waba","meta-platform")).status,200);
  assert.equal(await f.prisma.prospectInboxEvent.count(),1);assert.equal(await f.prisma.prospectEndpoint.count(),2);
  assert.equal((await f.post({messages:[{...value.messages[0],text:{body:"divergent exclusive replay"}}]})).status,409);
  assert.equal(await f.prisma.prospectInboxEvent.count(),1);assert.equal((await f.pg.query("SELECT * FROM merchant_routed")).rowCount,0);
 }finally{await f.close();}
});

test("OWN-SENDER AC4 the dedicated callback acknowledges shared prospect events and forwards only the merchant remainder",async()=>{
 const f=await fixture();try{
  const send=(value:Record<string,unknown>)=>f.post(value,undefined,"waba","meta-platform");
  assert.equal((await send({messages:[message("dedicated-prospect-only","5511999999999")]})).status,200);
  assert.equal(await f.prisma.prospectInboxEvent.count(),1);assert.equal((await f.pg.query("SELECT * FROM merchant_routed")).rowCount,0);
  assert.equal((await send({messages:[message("dedicated-prospect-mixed","5511999999999"),message("dedicated-buyer","5511988888888")],statuses:[{id:"wamid.prospect.out",status:"read",recipient_id:"5511999999999",timestamp:"1700000000"},{id:"wamid.store.out",status:"read",recipient_id:"5511988888888",timestamp:"1700000000"}]})).status,200);
  assert.equal(await f.prisma.prospectInboxEvent.count(),3);
  assert.deepEqual((await f.pg.query("SELECT kind,provider_id FROM merchant_routed ORDER BY kind")).rows,[{kind:"META",provider_id:"dedicated-buyer"},{kind:"delivery",provider_id:"wamid.store.out"},{kind:"fiscal",provider_id:"wamid.store.out"},{kind:"status",provider_id:"wamid.store.out"}]);
  await f.prisma.platformProspectSenderBinding.update({where:{id:"sender"},data:{phoneNumberId:"not-this-phone"}});
  assert.equal((await send({messages:[message("unbound-dedicated","5511988888888")]})).status,503);assert.equal(await f.prisma.prospectInboxEvent.count(),3);
 }finally{await f.close();}
});
