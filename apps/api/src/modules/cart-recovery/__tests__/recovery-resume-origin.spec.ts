import "reflect-metadata";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { RecoveryResumeOriginService } from "../application/services/recovery-resume-origin.service.js";
import { ResumeRecoveryCheckoutUseCase } from "../application/use-cases/resume-recovery-checkout.use-case.js";
import { RecoveryCheckoutController } from "../presentation/http/recovery-checkout.controller.js";
import { recoveryStoreUrl } from "../application/use-cases/generate-recovery-link.use-case.js";
import { NestFactory } from "@nestjs/core";
import { GenerateRecoveryLinkUseCase } from "../application/use-cases/generate-recovery-link.use-case.js";
import { RecoveryLinkTokenService } from "../domain/recovery-link-token.service.js";
import { checkoutSession } from "../../checkout/__tests__/checkout-test-fixtures.js";
import { InMemoryCheckoutRepository } from "../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { createPrismaClient } from "../../../shared/persistence/prisma-client.js";

const secret="local-resume-origin-secret-at-least-32-characters";
const config={id:"official-config",merchantId:"origin-store",enabled:true,provider:"META_CLOUD",status:"ACTIVE",whatsappNumber:"+55 21 99999-0000",credentials:{accessToken:"local-only",wabaId:"123456789",phoneNumberId:"987654321"}};
async function fixture(native=true) {
  const session=checkoutSession({merchantId:config.merchantId,sessionId:"checkout-origin",conversationId:"checkout-conversation"});
  session.cart={...session.cart,cart_ref:"canonical-origin-cart"};
  const sessions=new InMemoryCheckoutRepository();await sessions.saveSession(session);
  const state:any={config:{...config},whatsapp:native?{merchantId:session.merchantId,checkoutSessionId:null,conversationState:{conversationId:"canonical-origin-cart"},deviceId:"META_CLOUD:official-config"}:null,lookupError:false,paid:false,ordered:false};
  const prisma:any={completedOrder:{findFirst:async()=>state.ordered?{id:"paid-order"}:null},paymentIntent:{findFirst:async()=>state.paid?{id:"paid-intent"}:null},merchant:{findUnique:async({where}:any)=>where.id===session.merchantId?{storeSlug:"origin-shop"}:null},whatsAppSession:{findFirst:async(query:any)=>{
    assert.equal(query.where.merchantId,session.merchantId);
    assert.ok(query.where.OR.some((x:any)=>x.checkoutSessionId===session.sessionId));
    if(state.lookupError)throw Error("owned lookup unavailable");return state.whatsapp;
  }}};
  const configs:any={findById:async(id:string)=>{assert.equal(id,"official-config");return state.config;},findByMerchantId:async()=>assert.fail("connection must follow the persisted device")};
  let issued=0;const actual=new RecoveryLinkTokenService(secret);
  const tokens={issue:(merchant:string,id:string)=>{issued++;return actual.issue(merchant,id);}} as RecoveryLinkTokenService;
  const origins=new RecoveryResumeOriginService(prisma,configs);
  const generate=new GenerateRecoveryLinkUseCase(prisma,sessions,tokens,origins);
  return {state,session,prisma,configs,origins,generate,sessions,actual,issued:()=>issued,input:{merchantId:session.merchantId,sessionId:session.sessionId}};
}

test("native bound and shopping carts generate only the official WhatsApp destination and cart command",async()=>{
  for(const bound of [false,true]) {
    const h=await fixture();if(bound)h.state.whatsapp={...h.state.whatsapp,checkoutSessionId:h.session.sessionId,conversationState:{conversationId:"another-conversation"}};
    const url=new URL(await h.generate.execute(h.input));
    assert.equal(url.origin,"https://wa.me");assert.equal(url.pathname,"/5521999990000");
    assert.deepEqual([...url.searchParams.entries()],[["text","Ver carrinho"]]);assert.equal(h.issued(),0);
  }
});

test("unavailable or foreign native connections never fall back to a website token",async()=>{
  for(const patch of [null,{enabled:false},{status:"DISCONNECTED"},{provider:"BUBBLEWHATS"},{merchantId:"other-store"},{id:"other-config"},{whatsappNumber:"invalid"},{whatsappNumber:undefined},{credentials:{}}]) {
    const h=await fixture();h.state.config=patch===null?null:{...config,...patch};
    await assert.rejects(h.generate.execute(h.input),/recovery_whatsapp_connection_unavailable/);assert.equal(h.issued(),0);
  }
  for(const patch of [{merchantId:"foreign-store"},{deviceId:"legacy-device"},{conversationState:{conversationId:"foreign-cart"},checkoutSessionId:"foreign-checkout"}]) {
    const h=await fixture();h.state.whatsapp={...h.state.whatsapp,...patch};
    await assert.rejects(h.generate.execute(h.input),/recovery_whatsapp_connection_unavailable/);assert.equal(h.issued(),0);
  }
});

test("origin lookup failure cannot issue a website token",async()=>{
  const h=await fixture();h.state.lookupError=true;
  await assert.rejects(h.generate.execute(h.input),/recovery_origin_unavailable/);assert.equal(h.issued(),0);
});

test("a storefront cart retains its signed scoped checkout URL",async()=>{
  const h=await fixture(false);const url=new URL(await h.generate.execute(h.input));
  assert.equal(url.pathname,"/store/origin-shop");assert.equal(url.searchParams.get("show"),"checkout");
  const claims=h.actual.verify(url.searchParams.get("recovery"));assert.equal(claims.merchantId,h.session.merchantId);assert.equal(claims.sessionId,h.session.sessionId);assert.equal(h.issued(),1);
});

test("native WhatsApp recovery does not require a published storefront slug",async()=>{
  const h=await fixture();h.prisma.merchant.findUnique=async()=>({storeSlug:null});
  assert.equal(new URL(await h.generate.execute(h.input)).origin,"https://wa.me");assert.equal(h.issued(),0);
});

const db=createPrismaClient("postgresql://postgres@127.0.0.1:15565/athom_qa");
after(async()=>db.$disconnect());
test("persisted PostgreSQL channel ownership is isolated by merchant and canonical cart",async t=>{
  const merchantId="qa_recovery_origin_"+randomUUID(),foreignId="qa_recovery_origin_"+randomUUID();
  await db.merchant.createMany({data:[{id:merchantId,name:"Owned origin QA"},{id:foreignId,name:"Owned foreign origin QA"}]});
  t.after(async()=>{for(const id of [merchantId,foreignId]){assert.ok(id.startsWith("qa_recovery_origin_"));await db.whatsAppSession.deleteMany({where:{merchantId:id}});await db.merchant.delete({where:{id}});}});
  const session=checkoutSession({merchantId,sessionId:"origin_"+randomUUID(),conversationId:"conversation_"+randomUUID()});session.cart={...session.cart,cart_ref:"cart_"+randomUUID()};
  const service=new RecoveryResumeOriginService(db,{findById:async()=>({...config,merchantId})} as any);
  await db.whatsAppSession.create({data:{merchantId:foreignId,buyerPhone:"5511000000000",deviceId:"META_CLOUD:official-config",checkoutSessionId:session.sessionId,conversationState:{conversationId:session.cart.cart_ref}}});
  assert.deepEqual(await service.resolve(session),{channel:"storefront"});
  await db.whatsAppSession.create({data:{merchantId,buyerPhone:"5511000000000",deviceId:"META_CLOUD:official-config",conversationState:{conversationId:session.cart.cart_ref}}});
  const result=await service.resolve(session);assert.equal(result.channel,"whatsapp");
  if(result.channel==="whatsapp")assert.equal(new URL(result.url).pathname,"/5521999990000");
});

async function legacyFixture(native=true) {
  const h=await fixture(native);const calls={buyer:0,embed:0};
  const buyers={resolve:async()=>{calls.buyer++;throw Error("website login must not be used for native recovery");}};
  const issue={execute:()=>{calls.embed++;throw Error("website credentials must not be issued for native recovery");}};
  const resume=new ResumeRecoveryCheckoutUseCase(h.prisma,h.sessions,h.actual,buyers as any,issue as any,h.origins);
  return {...h,resume,calls,request:{slug:"origin-shop",token:h.actual.issue(h.session.merchantId,h.session.sessionId),origin:recoveryStoreUrl("origin-shop").origin}};
}

test("a legacy native link returns only merchant WhatsApp continuation without website login or credentials",async()=>{
  const h=await legacyFixture();const result=await h.resume.execute(h.request);
  assert.deepEqual(result,{version:1,merchant_id:"origin-store",resume_channel:"whatsapp",whatsapp_resume_url:"https://wa.me/5521999990000?text=Ver+carrinho"});
  assert.deepEqual(h.calls,{buyer:0,embed:0});
});

test("native legacy resolution retains invalid token store origin and completed-purchase barriers",async()=>{
  const h=await legacyFixture();
  await assert.rejects(h.resume.execute({...h.request,token:h.request.token+"x"}),/recovery_link_invalid_or_expired/);
  const old=h.actual.issue(h.session.merchantId,h.session.sessionId,Math.floor(Date.now()/1000)-4*24*3600);
  await assert.rejects(h.resume.execute({...h.request,token:old}),/recovery_link_invalid_or_expired/);
  await assert.rejects(h.resume.execute({...h.request,slug:"foreign-store"}),/recovery_store_mismatch/);
  await assert.rejects(h.resume.execute({...h.request,origin:"https://foreign.example"}),/recovery_origin_not_allowed/);
  const foreign=h.actual.issue("foreign-merchant",h.session.sessionId);
  await assert.rejects(h.resume.execute({...h.request,token:foreign}),/recovery_store_mismatch/);
  h.state.paid=true;await assert.rejects(h.resume.execute(h.request),/recovery_purchase_completed/);
  h.state.paid=false;h.state.ordered=true;await assert.rejects(h.resume.execute(h.request),/recovery_purchase_completed/);
  assert.deepEqual(h.calls,{buyer:0,embed:0});
});

test("unavailable native origin never falls through to website login or credentials",async()=>{
  const h=await legacyFixture();h.state.lookupError=true;
  await assert.rejects(h.resume.execute(h.request),/recovery_origin_unavailable/);assert.deepEqual(h.calls,{buyer:0,embed:0});
});

test("real HTTP native resolution is no-store scoped and needs no website bearer token",async()=>{
  const h=await legacyFixture();Reflect.defineMetadata("design:paramtypes",[ResumeRecoveryCheckoutUseCase],RecoveryCheckoutController);
  const app=await NestFactory.create({module:class OwnedNativeRecoveryHttp{},controllers:[RecoveryCheckoutController],providers:[{provide:ResumeRecoveryCheckoutUseCase,useValue:h.resume}]},{logger:false});
  try {
    await app.listen(0,"127.0.0.1");const url=await app.getUrl();const headers={"content-type":"application/json",origin:h.request.origin};
    const response=await fetch(url+"/storefront/origin-shop/recovery",{method:"POST",headers,body:JSON.stringify({token:h.request.token})});
    assert.equal(response.status,201);assert.equal(response.headers.get("cache-control"),"no-store");assert.equal(response.headers.get("referrer-policy"),"no-referrer");
    assert.deepEqual(await response.json(),{version:1,merchant_id:"origin-store",resume_channel:"whatsapp",whatsapp_resume_url:"https://wa.me/5521999990000?text=Ver+carrinho"});
    const foreign=await fetch(url+"/storefront/origin-shop/recovery",{method:"POST",headers:{...headers,origin:"https://foreign.example"},body:JSON.stringify({token:h.request.token})});
    assert.equal(foreign.status,403);assert.deepEqual(h.calls,{buyer:0,embed:0});
  } finally {await app.close();}
});
