import "reflect-metadata";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { RecoveryResumeOriginService } from "../application/services/recovery-resume-origin.service.js";
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
  const state:any={config:{...config},whatsapp:native?{merchantId:session.merchantId,checkoutSessionId:null,conversationState:{conversationId:"canonical-origin-cart"},deviceId:"META_CLOUD:official-config"}:null,lookupError:false};
  const prisma:any={merchant:{findUnique:async()=>({storeSlug:"origin-shop"})},whatsAppSession:{findFirst:async(query:any)=>{
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
