import "reflect-metadata";
import test,{after,type TestContext} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createPrismaClient} from "../../../../shared/persistence/prisma-client.js";
import {RouteToSessionUseCase} from "./route-to-session.use-case.js";
import {PrismaWhatsAppSessionRepository} from "../../infrastructure/repositories/prisma-whatsapp-session.repository.js";
import {PrismaStorefrontCartRepository} from "../../../storefront/infrastructure/repositories/prisma-storefront-cart.repository.js";
import {PrismaCheckoutRepository} from "../../../checkout/infrastructure/prisma/prisma-checkout.repository.js";
import {checkoutSession} from "../../../checkout/__tests__/checkout-test-fixtures.js";

const db=createPrismaClient("postgresql://postgres@127.0.0.1:15565/athom_qa");after(async()=>db.$disconnect());
const items=[{productId:"qa-mouse",variantId:"qa-white",sku:"qa-m170",name:"Owned QA mouse",quantity:2,unitPriceCents:6990}];
async function fixture(t:TestContext,bound=true){
 const merchantId="qa_native_renewal_"+randomUUID(),foreignId="qa_native_renewal_"+randomUUID(),cartRef=randomUUID(),phone="5511000000000",deviceId="META_CLOUD:"+randomUUID();
 await db.merchant.createMany({data:[{id:merchantId,name:"Owned renewal QA"},{id:foreignId,name:"Owned foreign renewal QA"}]});
 t.after(async()=>{for(const id of [merchantId,foreignId]){assert.ok(id.startsWith("qa_native_renewal_"));await db.paymentIntent.deleteMany({where:{merchantId:id}});await db.whatsAppSession.deleteMany({where:{merchantId:id}});await db.checkoutSession.deleteMany({where:{merchantId:id}});await db.storefrontCart.deleteMany({where:{merchantId:id}});await db.buyerIdentity.deleteMany({where:{merchantId:id}});await db.merchant.delete({where:{id}});}});
 const cart=await db.storefrontCart.create({data:{merchantId,sessionId:cartRef,items,total:13980,expiresAt:new Date(Date.now()+48*3600_000)}});
 // This is a returning native buyer: initial routing already registered its scoped identity.
 await db.buyerIdentity.create({data:{merchantId,identityKey:"phone:"+phone,globalUserId:"qa-native-buyer-"+randomUUID()}});
 const checkoutId=bound?"qa-bound-"+randomUUID():undefined;
 if(checkoutId){const session=checkoutSession({merchantId,sessionId:checkoutId,conversationId:cartRef});session.cart={...session.cart,cart_ref:cartRef};await new PrismaCheckoutRepository(db).saveSession(session);}
 const row=await db.whatsAppSession.create({data:{merchantId,buyerPhone:phone,deviceId,checkoutSessionId:checkoutId,lastActivityAt:new Date(Date.now()-25*3600_000),status:"active",conversationState:{version:1,conversationId:cartRef,stage:bound?"checkout":"store",checkoutSessionId:checkoutId,history:[{message:"old private history"}],payment:{intentId:"old-private-intent"},selections:{old:"old-private-selection"}}}});
 const repo=new PrismaWhatsAppSessionRepository(db),route=new RouteToSessionUseCase(repo,db);
 const run=()=>route.execute({merchantId,deviceId,fromNumber:phone,fromAlias:"Owned QA buyer"});
 return{merchantId,foreignId,cartRef,phone,deviceId,checkoutId,row,cart,repo,route,run};
}

for(const bound of [false,true])test("expired native conversation retains its valid canonical cart with fresh state, bound="+bound,async t=>{
 const f=await fixture(t,bound),beforeCount=await db.checkoutSession.count({where:{merchantId:f.merchantId}}),result=await f.run();
 assert.equal(result.isNew,true);assert.equal(result.checkoutSessionId,undefined);assert.equal(result.whatsappSession.checkoutSessionId,undefined);
 assert.deepEqual(result.whatsappSession.conversationState,{version:1,conversationId:f.cartRef,stage:"store",history:[],revision:"",page:0,previousViews:[]});
 assert.deepEqual(await db.storefrontCart.findUniqueOrThrow({where:{id:f.cart.id}}),f.cart);
 const restored=await new PrismaStorefrontCartRepository(db).getOrCreate(f.merchantId,result.whatsappSession.conversationState!.conversationId);
 assert.deepEqual(restored.items,items);assert.equal(restored.total,13980);
 assert.equal(await db.checkoutSession.count({where:{merchantId:f.merchantId}}),beforeCount);
 assert.equal(result.buyerData.email,undefined);assert.equal(result.buyerData.cpf,undefined);assert.equal(result.buyerData.address,undefined);
 assert.equal(await db.paymentIntent.count({where:{merchantId:f.merchantId}}),0);
});

for(const variant of ["empty","expired","absent","foreign","completed","approved","completed_state","missing_bound_checkout"])test("expired native renewal does not restore "+variant,async t=>{
 const f=await fixture(t);
 if(variant==="empty")await db.storefrontCart.update({where:{id:f.cart.id},data:{items:[]}});
 if(variant==="expired")await db.storefrontCart.update({where:{id:f.cart.id},data:{expiresAt:new Date(0)}});
 if(variant==="absent")await db.storefrontCart.delete({where:{id:f.cart.id}});
 if(variant==="foreign")await db.storefrontCart.update({where:{id:f.cart.id},data:{merchantId:f.foreignId}});
 if(variant==="completed")await db.completedOrder.create({data:{merchantId:f.merchantId,sessionId:f.checkoutId!,externalOrderId:randomUUID(),orderTotal:139.8,currency:"BRL",completedAt:new Date()}});
 if(variant==="approved")await db.paymentIntent.create({data:{id:randomUUID(),merchantId:f.merchantId,sessionId:f.checkoutId!,idempotencyKey:randomUUID(),amountCents:13980,currency:"BRL",method:"pix",status:"approved"}});
 if(variant==="completed_state")await db.whatsAppSession.update({where:{id:f.row.id},data:{lastActivityAt:f.row.lastActivityAt,conversationState:{version:1,stage:"completed",conversationId:f.cartRef}}});
 if(variant==="missing_bound_checkout")await db.checkoutSession.deleteMany({where:{merchantId:f.merchantId}});
 const result=await f.run();assert.equal(result.isNew,true);assert.notEqual(result.whatsappSession.conversationState?.conversationId,f.cartRef);assert.equal(result.checkoutSessionId,undefined);
 assert.deepEqual(result.whatsappSession.conversationState?.history,[]);
});

test("foreign paid checkout sharing a canonical reference cannot suppress the owned native cart",async t=>{
 const f=await fixture(t,false),foreign=checkoutSession({merchantId:f.foreignId,sessionId:randomUUID(),conversationId:f.cartRef});foreign.cart={...foreign.cart,cart_ref:f.cartRef};
 await new PrismaCheckoutRepository(db).saveSession(foreign);await db.completedOrder.create({data:{merchantId:f.foreignId,sessionId:foreign.sessionId,externalOrderId:randomUUID(),orderTotal:139.8,currency:"BRL",completedAt:new Date()}});
 assert.equal((await f.run()).whatsappSession.conversationState?.conversationId,f.cartRef);
});

for(const field of ["merchantId","buyerPhone","deviceId"])test("renewal rejects a mismatched persisted "+field+" without changing the old session",async t=>{
 const f=await fixture(t),persisted=await f.repo.findActiveByPhone(f.merchantId,f.phone,f.deviceId);assert.ok(persisted);
 t.mock.method(f.repo,"findActiveByPhone",async()=>({...persisted,[field]:"foreign-value"}));
 await assert.rejects(f.run(),/whatsapp_recovery_scope_unavailable/);
 assert.deepEqual(await db.whatsAppSession.findUniqueOrThrow({where:{id:f.row.id}}),f.row);
});

for(const model of ["storefrontCart","checkoutSession","completedOrder","paymentIntent"])test("required "+model+" lookup failure preserves the expired native session for retry",async t=>{
 const f=await fixture(t),transact=db.$transaction.bind(db);
 const failingDb=new Proxy(db,{get(target,key){if(key==="$transaction")return(work:any)=>transact(async tx=>work(new Proxy(tx,{get(context,k){if(k===model)return new Proxy((context as any)[k],{get(delegate,method){if(method===(model==="storefrontCart"?"findUnique":model==="checkoutSession"?"findMany":"findFirst"))return async()=>{throw Error("owned persistence lookup unavailable");};return Reflect.get(delegate,method);}});return Reflect.get(context,k);}})));return Reflect.get(target,key);}});
 const route=new RouteToSessionUseCase(new PrismaWhatsAppSessionRepository(failingDb),failingDb);
 await assert.rejects(route.execute({merchantId:f.merchantId,deviceId:f.deviceId,fromNumber:f.phone}),/whatsapp_recovery_cart_unavailable/);
 assert.deepEqual(await db.whatsAppSession.findUniqueOrThrow({where:{id:f.row.id}}),f.row);
});

test("already expired native rows retain a valid cart when renewed after an interrupted previous attempt",async t=>{
 const f=await fixture(t);await db.whatsAppSession.update({where:{id:f.row.id},data:{status:"expired"}});
 const result=await f.run();assert.equal(result.isNew,true);assert.equal(result.whatsappSession.conversationState?.conversationId,f.cartRef);
 assert.equal(result.checkoutSessionId,undefined);assert.deepEqual(result.whatsappSession.conversationState?.history,[]);
});

test("concurrent expired native renewals retain one canonical cart and one fresh state",async t=>{
 const f=await fixture(t),results=await Promise.all([f.run(),f.run()]);
 for(const result of results){assert.equal(result.whatsappSession.conversationState?.conversationId,f.cartRef);assert.equal(result.checkoutSessionId,undefined);assert.deepEqual(result.whatsappSession.conversationState?.history,[]);}
 assert.equal(results.filter(x=>x.isNew).length,1);assert.equal(await db.whatsAppSession.count({where:{merchantId:f.merchantId}}),1);
});

test("renewal never overwrites a newer active conversation discovered under the repository lock",async t=>{
 const f=await fixture(t),renew=f.repo.renewExpiredNative.bind(f.repo),newRef=randomUUID();
 t.mock.method(f.repo,"renewExpiredNative",async expected=>{await db.whatsAppSession.update({where:{id:f.row.id},data:{lastActivityAt:new Date(),checkoutSessionId:"newer-checkout",conversationState:{version:1,stage:"store",conversationId:newRef,history:[]}}});return renew(expected);});
 const result=await f.run();assert.equal(result.isNew,false);assert.equal(result.whatsappSession.conversationState?.conversationId,newRef);assert.equal(result.checkoutSessionId,"newer-checkout");
});

test("an active native session preserves its existing checkout and conversation state",async t=>{
 const f=await fixture(t);await db.whatsAppSession.update({where:{id:f.row.id},data:{lastActivityAt:new Date()}});
 const result=await f.run();assert.equal(result.isNew,false);assert.equal(result.checkoutSessionId,f.checkoutId);assert.deepEqual(result.whatsappSession.conversationState,f.row.conversationState);
});
