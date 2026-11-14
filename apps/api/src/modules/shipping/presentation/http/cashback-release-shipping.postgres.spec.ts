import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";
import { PrismaClient } from "@prisma/client";
import type { CashbackRules, CheckoutSession } from "@zyon/shared-types";
import type { CarrierPort } from "../../domain/ports/carrier.port.js";
import { QuoteShippingUseCase } from "../../application/use-cases/quote-shipping.use-case.js";
import { SelectShippingMethodUseCase } from "../../application/use-cases/select-shipping-method.use-case.js";
import { EmbedShippingController } from "./embed-shipping.controller.js";
import { PrismaShippingQuoteRepository } from "../../infrastructure/repositories/prisma-shipping-quote.repository.js";
import { PrismaOwnDeliveryConfigRepository } from "../../infrastructure/repositories/prisma-own-delivery-config.repository.js";
import { PrismaCheckoutRepository } from "../../../checkout/infrastructure/prisma/prisma-checkout.repository.js";
import { PrismaMerchantRepository } from "../../../merchant/infrastructure/prisma-merchant.repository.js";
import { checkoutSession, merchantRules } from "../../../checkout/__tests__/checkout-test-fixtures.js";
import { embedCheckoutSessionId } from "../../../embed/domain/embed-checkout-session.js";
import { CheckoutShippingService } from "../../../checkout/application/services/checkout-shipping.service.js";
import { CheckoutCustomerService } from "../../../checkout/application/services/checkout-customer.service.js";
import { CashbackRepository } from "../../../cashback/infrastructure/cashback.repository.js";
import { CheckoutCommercialBenefitsService } from "../../../cashback/application/checkout-commercial-benefits.service.js";
import { CashbackService } from "../../../cashback/application/cashback.service.js";

// Native PostgreSQL/Prisma, real repositories/controller/guards/CAS and actual
// version trigger. Only remote transport/locality lookups are test adapters.
// Never load .env, contact a provider, reuse a QA tenant or mutate production.
const base="postgresql://cashback:cashback-local-test@127.0.0.1:15433/cashback_seed_qa_compiled";
const schema=`cashback_release_shipping_${randomUUID().replaceAll("-","")}`;
const databaseUrl=`${base}?schema=${schema}`;
const bootstrap=new pg.Client({connectionString:base});
const apiRoot=fileURLToPath(new URL("../../../../../",import.meta.url));
const originalFetch=globalThis.fetch;
let prisma:PrismaClient, sessions:PrismaCheckoutRepository, quotes:PrismaShippingQuoteRepository;
let own:PrismaOwnDeliveryConfigRepository, merchants:PrismaMerchantRepository;
let cashback:CashbackService;
let forbiddenFetches=0,viaCepLookups=0;

before(async()=>{
  await bootstrap.connect();await bootstrap.query(`CREATE SCHEMA "${schema}"`);
  const require=createRequire(import.meta.url);
  await promisify(execFile)(process.execPath,[require.resolve("prisma/build/index.js"),"db","push","--schema","prisma/schema.prisma","--skip-generate"],
    {cwd:apiRoot,env:{...process.env,DATABASE_URL:databaseUrl},maxBuffer:1024*1024});
  await bootstrap.query(`SET search_path TO "${schema}"`);
  await bootstrap.query(await readFile(new URL("../../../../../prisma/migrations/20260929020000_checkout_session_write_version/migration.sql",import.meta.url),"utf8"));
  prisma=new PrismaClient({datasources:{db:{url:databaseUrl}}});
  const cashRepo=new CashbackRepository(prisma),benefits=new CheckoutCommercialBenefitsService(cashRepo);cashback=new CashbackService(cashRepo,benefits);
  sessions=new PrismaCheckoutRepository(prisma,false,undefined,benefits);quotes=new PrismaShippingQuoteRepository(prisma,benefits);
  own=new PrismaOwnDeliveryConfigRepository(prisma);merchants=new PrismaMerchantRepository(prisma);
  globalThis.fetch=async(input)=>{
    const url=String(input);
    if(!/^https:\/\/viacep\.com\.br\/ws\/(01001000|02002000)\/json\/$/.test(url)){forbiddenFetches++;throw Error("QA_REMOTE_NETWORK_FORBIDDEN");}
    viaCepLookups++;
    return new Response(JSON.stringify({logradouro:"QA Street",bairro:"Centro",localidade:"QA City",uf:"SP"}),{status:200,headers:{"content-type":"application/json"}});
  };
});
after(async()=>{
  globalThis.fetch=originalFetch;await prisma?.$disconnect();
  await bootstrap.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await bootstrap.end();
  assert.equal(forbiddenFetches,0,"every external lookup was intercepted; no provider/network forwarding");
});

async function fixture(mode:"flat"|"neighborhood"|"carrier"="flat", dimensions=false){
  const suffix=randomUUID(),merchantId=`qa_shipping_${suffix}`,buyerId=`qa_shipping_buyer_${suffix}`;
  const claims={typ:"aacp_embed_v1"as const,merchantId,nonce:`qa_shipping_nonce_${suffix}`,issuedAtUnix:1,expiresAtUnix:9999999999};
  const sessionId=embedCheckoutSessionId(claims),productId=`qa_product_${suffix}`,variantId=`qa_variant_${suffix}`;
  await prisma.merchant.create({data:{id:merchantId,name:"QA isolated shipping",melhorEnvioEnabled:mode==="carrier",
    storeSettings:{company:{address:{zip:"01001000",city:"QA City",state:"SP"}}}}});
  await prisma.merchantRule.create({data:{merchantId,...merchantRules({originZip:"01001000",allowFreeShipping:true,freeShippingMinCartValue:500})}});
  await prisma.buyerAccount.create({data:{globalUserId:buyerId,email:`${suffix}@cashback.invalid`,displayName:"QA"}});
  await prisma.product.create({data:{id:productId,merchantId,name:"QA Physical",type:"physical"}});
  await prisma.productVariant.create({data:{id:variantId,productId,sku:`QA_${suffix}`,weightGrams:1000,heightCm:10,widthCm:15,lengthCm:20}});
  await prisma.productPrice.create({data:{variantId,basePriceInCents:11800,currency:"BRL"}});
  if(mode!=="carrier")await prisma.ownDeliveryConfig.create({data:{merchantId,enabled:true,mode,flatPriceCents:mode==="flat"?900:null,freeAboveCents:null,
    neighborhoods:mode==="neighborhood"?[{name:"Centro",priceCents:1375},{name:"Cheaper",priceCents:1}]:undefined,estimatedValue:1,estimatedUnit:"days"}});
  const input=checkoutSession({merchantId,sessionId,globalUserId:buyerId,shipping:undefined,shippingOptions:undefined,
    customer:{email:`${suffix}@cashback.invalid`,email_verified:true,address_verified:true,address:{zip:"02002000",street:"QA",number:"1",complement:"",neighborhood:"Centro",city:"QA City",state:"SP"}},
    cart:{currency:"BRL",total:118,items:[{sku:`QA_${suffix}`,variantId,product_id:productId,name:"QA Physical",price:118,quantity:1,productType:"physical",
      ...(dimensions?{weightGrams:1000,height_cm:10,width_cm:15,length_cm:20}:{})}]}});
  await sessions.saveSession(input);
  let carrierCalls=0;
  const carrier:CarrierPort={carrierKey:"pac",async fetchQuotes(context){carrierCalls++;assert.equal(context.cartTotalCents,11800);
    assert.deepEqual(context.packages,[{weightKg:1,heightCm:10,widthCm:15,lengthCm:20,quantity:1}]);
    return[{carrier_key:"pac",label:"QA carrier adapter (no network)",price:1500,eta_days:5,is_free:false}];}};
  const quote=new QuoteShippingUseCase(quotes,[carrier],merchants,own,[],prisma);
  const select=new SelectShippingMethodUseCase(quotes,sessions,prisma,quote,own);
  const controller=new EmbedShippingController(quote,select,merchants,sessions);
  const body={session_id:sessionId,destination_zip:"02002000",cart_total:999999,destination_neighborhood:"Cheaper",destination_city:"Forged City",
    destination_state:"RJ",packages:[{weightKg:.001,heightCm:1,widthCm:1,lengthCm:1,quantity:1}]};
  return{merchantId,buyerId,sessionId,claims,body,controller,quote,select,carrierCalls:()=>carrierCalls};
}

test("CR-SHIP-01 real normal PG guards permit configured flat quote/select without parcel dimensions or provider",async()=>{
  const f=await fixture("flat"),initial=(await sessions.getSession(f.merchantId,f.sessionId))!,lookups=viaCepLookups;
  const result=await f.controller.quote({embedClaims:f.claims},f.body as never);
  assert.equal(result.results.length,1);assert.equal(result.results[0]!.carrier_key,"own_delivery_flat");assert.equal(result.results[0]!.price,900);
  assert.equal(result.results[0]!.is_free,false);assert.equal(f.carrierCalls(),0);assert.equal(viaCepLookups-lookups,2);
  const before=(await sessions.getSession(f.merchantId,f.sessionId))!;
  assert.equal(before.persistenceVersion,initial.persistenceVersion!+1);
  const selected=await f.controller.select({embedClaims:f.claims},{session_id:f.sessionId,carrier_key:"own_delivery_flat",quote_id:result.id});
  assert.equal(selected.selected_carrier_key,"own_delivery_flat");
  const stored=(await sessions.getSession(f.merchantId,f.sessionId))!;
  assert.equal(stored.persistenceVersion,before.persistenceVersion!+1);assert.equal(stored.cart.total,118);
  assert.equal(stored.shipping!.customerPrice,9);assert.equal(stored.shipping!.realCost,9);assert.equal(stored.shipping!.quoteId,result.id);
  assert.equal((await prisma.shippingQuote.findUniqueOrThrow({where:{id:result.id}})).selectedCarrierKey,"own_delivery_flat");
  assert.equal(await prisma.outboxMessage.count({where:{merchantId:f.merchantId,eventType:"shipping.quote.created"}}),1);
});

test("CR-SHIP-02 real persisted locality ignores forged district/city and invalidates a neighborhood quote after address changes",async()=>{
  const f=await fixture("neighborhood"),lookups=viaCepLookups;
  const result=await f.controller.quote({embedClaims:f.claims},f.body as never);
  assert.equal(result.results.length,1);assert.equal(result.results[0]!.price,1375);assert.equal(result.results[0]!.is_free,false);
  assert.equal(result.results[0]!.carrier_key,"own_delivery_neighborhood_centro");assert.equal(viaCepLookups,lookups);assert.equal(f.carrierCalls(),0);
  const selected=await f.controller.select({embedClaims:f.claims},{session_id:f.sessionId,carrier_key:result.results[0]!.carrier_key,quote_id:result.id});
  assert.equal(selected.shipping!.customerPrice,13.75);
  const expected=(await sessions.getSession(f.merchantId,f.sessionId))!;
  const next:CheckoutSession={...structuredClone(expected),customer:{...expected.customer,address:{...expected.customer!.address,city:"Another City"}},shipping:undefined};
  await sessions.commitCommercialMutation({expected,next});
  const after=(await sessions.getSession(f.merchantId,f.sessionId))!;
  await assert.rejects(f.controller.select({embedClaims:f.claims},{session_id:f.sessionId,carrier_key:result.results[0]!.carrier_key,quote_id:result.id}),/shipping_quote_changed|shipping_quote_review_required/);
  assert.deepEqual(await sessions.getSession(f.merchantId,f.sessionId),after);
  const newQuote=await f.controller.quote({embedClaims:f.claims},f.body as never);assert.deepEqual(newQuote.results,[]);
});

test("CR-SHIP-03 missing canonical dimensions remove carrier eligibility and cannot reuse a prior valid quote or browser package",async()=>{
  const f=await fixture("carrier",true);
  const first=await f.controller.quote({embedClaims:f.claims},f.body as never);
  assert.equal(first.results.length,1);assert.equal(first.results[0]!.price,1500);assert.equal(first.results[0]!.is_free,false);assert.equal(f.carrierCalls(),1);
  const expected=(await sessions.getSession(f.merchantId,f.sessionId))!;
  const next=structuredClone(expected);delete next.cart.items[0]!.height_cm;
  await sessions.commitCommercialMutation({expected,next});
  const result=await f.controller.quote({embedClaims:f.claims},f.body as never);
  assert.deepEqual(result.results,[]);assert.notEqual(result.id,first.id);assert.equal(f.carrierCalls(),1);
  await assert.rejects(f.controller.select({embedClaims:f.claims},{session_id:f.sessionId,carrier_key:"pac",quote_id:first.id}),/shipping_quote_changed/);
  const stored=(await sessions.getSession(f.merchantId,f.sessionId))!;assert.equal(stored.shipping,undefined);
});

test("CR-SHIP-04 actual PG guards reject foreign embed scope, stored marketplace lines, pending payment and digital-only carts",async()=>{
  const f=await fixture("neighborhood"),before=await prisma.shippingQuote.count();
  await assert.rejects(f.controller.quote({embedClaims:{...f.claims,nonce:"foreign"}},f.body as never),/embed_checkout_session_binding_mismatch/);
  await prisma.crossStoreLineItem.create({data:{hostMerchantId:f.merchantId,checkoutSessionId:f.sessionId,sellerMerchantId:"qa_foreign_seller",federatedProductId:"qa_foreign_product",
    quantity:1,unitPriceCents:11800,commissionRateBps:0,commissionCents:0,sellerNetCents:11800}});
  await assert.rejects(f.controller.quote({embedClaims:f.claims},f.body as never),/marketplace_shipping_selection_required/);
  await prisma.crossStoreLineItem.deleteMany({where:{hostMerchantId:f.merchantId,checkoutSessionId:f.sessionId}});
  const intent=await prisma.paymentIntent.create({data:{id:randomUUID(),merchantId:f.merchantId,sessionId:f.sessionId,idempotencyKey:randomUUID(),amountCents:11800,currency:"BRL",method:"pix",status:"pending"}});
  await assert.rejects(f.controller.quote({embedClaims:f.claims},f.body as never),/shipping_change_requires_payment_cancellation/);
  await prisma.paymentIntent.update({where:{id:intent.id},data:{status:"cancelled"}});
  const expected=(await sessions.getSession(f.merchantId,f.sessionId))!,next=structuredClone(expected);next.cart.items[0]!.productType="digital";
  await sessions.commitCommercialMutation({expected,next});
  await assert.rejects(f.controller.quote({embedClaims:f.claims},f.body as never),/checkout_shipping_not_required/);
  assert.equal(await prisma.shippingQuote.count(),before);assert.equal(f.carrierCalls(),0);
});

test("CR-SHIP-05 tenant-scoped real manual configurations cannot quote the other tenant's cheaper tariff",async()=>{
  const a=await fixture("neighborhood"),b=await fixture("neighborhood");
  await prisma.ownDeliveryConfig.update({where:{merchantId:b.merchantId},data:{neighborhoods:[{name:"Centro",priceCents:1}]}});
  const quote=await a.controller.quote({embedClaims:a.claims},a.body as never);assert.equal(quote.results[0]!.price,1375);
  assert.equal(quote.merchant_id,a.merchantId);
  await assert.rejects(b.controller.select({embedClaims:b.claims},{session_id:b.sessionId,carrier_key:quote.results[0]!.carrier_key,quote_id:quote.id}),/shipping_quote_not_found/);
  assert.equal((await sessions.getSession(b.merchantId,b.sessionId))!.shipping,undefined);
  assert.equal(a.carrierCalls(),0);assert.equal(b.carrierCalls(),0);
});

test("CR-SHIP-06 canonical chat publication supplies real shipping options before the same embed selection guard",async()=>{
  const f=await fixture("neighborhood"),initial=(await sessions.getSession(f.merchantId,f.sessionId))!;
  const chat=new CheckoutShippingService(sessions,new CheckoutCustomerService(sessions),f.quote,undefined,undefined,prisma);
  const offered=await chat.processShippingState(initial,"frete");
  assert.equal(offered.shipping,undefined);assert.equal(offered.shippingOptions?.length,1);
  assert.equal(offered.shippingOptions![0]!.customerPrice,13.75);
  const stored=(await sessions.getSession(f.merchantId,f.sessionId))!;
  assert.equal(stored.persistenceVersion,initial.persistenceVersion!+1);
  assert.deepEqual(stored.shippingOptions,offered.shippingOptions);
  const option=offered.shippingOptions![0]!;
  const selected=await f.controller.select({embedClaims:f.claims},{session_id:f.sessionId,carrier_key:option.carrierKey!,quote_id:option.quoteId});
  assert.equal(selected.shipping!.customerPrice,13.75);
  assert.equal((await sessions.getSession(f.merchantId,f.sessionId))!.shipping!.quoteId,option.quoteId);
  assert.equal(f.carrierCalls(),0);
});

test("CR-SHIP-07 a real stale checkout CAS leaves the quote unselected and emits no selection event",async()=>{
  const f=await fixture("neighborhood"),quote=await f.controller.quote({embedClaims:f.claims},f.body as never);
  const before=(await sessions.getSession(f.merchantId,f.sessionId))!;
  const original=PrismaCheckoutRepository.prototype.commitCommercialMutation;
  PrismaCheckoutRepository.prototype.commitCommercialMutation=async function(input){
    return original.call(this,input.expected.sessionId===f.sessionId&&input.next.shipping
      ? {...input,expected:{...input.expected,persistenceVersion:input.expected.persistenceVersion!-1}}:input);
  };
  try{await assert.rejects(f.controller.select({embedClaims:f.claims},{session_id:f.sessionId,carrier_key:quote.results[0]!.carrier_key,quote_id:quote.id}),/CHECKOUT_SESSION_VERSION_CONFLICT/);}
  finally{PrismaCheckoutRepository.prototype.commitCommercialMutation=original;}
  assert.deepEqual(await sessions.getSession(f.merchantId,f.sessionId),before);
  assert.equal((await prisma.shippingQuote.findUniqueOrThrow({where:{id:quote.id}})).selectedCarrierKey,null);
  assert.equal(await prisma.outboxMessage.count({where:{merchantId:f.merchantId,eventType:"shipping.method.selected"}}),0);
});

async function fund(f:Awaited<ReturnType<typeof fixture>>){
  const rules:CashbackRules={earnRateBps:500,minimumEarnCents:0,maximumEarnPerOrderCents:null,buyerMonthlyEarnLimitCents:null,monthlyBudgetCents:null,
    releaseTrigger:"payment_confirmed",releaseDelayDays:0,expiryDays:null,minimumRedeemOrderCents:0,maximumRedeemBps:9000,maximumRedeemCents:null,allowWithDiscounts:true,
    terms:"Credito de validacao isolada QA sem provedor ou envio.",combination:{allowCoupons:true,allowAdvancedRules:true,limitMode:"cashback_specific",maximumCombinedDiscountBps:3000,maximumCombinedDiscountCents:null}};
  await cashback.saveDraft(f.merchantId,rules,"qa_owner");await cashback.publishProgram(f.merchantId,"qa_owner",{requireCombination:true});
  await cashback.adjustWallet(f.merchantId,f.buyerId,{amountCents:3000,reason:"Credito de validacao isolada",expiryDays:null,idempotencyKey:randomUUID()},"qa_owner");
  const session=(await sessions.getSession(f.merchantId,f.sessionId))!;await cashback.reserveCheckout(session,1500,randomUUID());
  return session;
}

test("CR-SHIP-08 a late quote/outbox failure rolls back checkout version and cashback release together",async()=>{
  const f=await fixture("neighborhood"),quote=await f.controller.quote({embedClaims:f.claims},f.body as never);
  const before=await fund(f),wallet=(await cashback.wallet(f.merchantId,f.buyerId)).balance;
  assert.equal(wallet.reservedCents,1500);
  const original=PrismaShippingQuoteRepository.prototype.saveWithEvents;
  PrismaShippingQuoteRepository.prototype.saveWithEvents=async function(entity){
    await original.call(this,entity);
    if(entity.snapshot().session_id===f.sessionId&&entity.snapshot().selected_carrier_key)throw Error("QA_LATE_SELECTION_WRITE_FAILURE");
  };
  try{await assert.rejects(f.controller.select({embedClaims:f.claims},{session_id:f.sessionId,carrier_key:quote.results[0]!.carrier_key,quote_id:quote.id}),/QA_LATE_SELECTION_WRITE_FAILURE/);}
  finally{PrismaShippingQuoteRepository.prototype.saveWithEvents=original;}
  assert.deepEqual(await sessions.getSession(f.merchantId,f.sessionId),before);
  assert.deepEqual((await cashback.wallet(f.merchantId,f.buyerId)).balance,wallet);
  assert.equal((await prisma.shippingQuote.findUniqueOrThrow({where:{id:quote.id}})).selectedCarrierKey,null);
  assert.equal(await prisma.outboxMessage.count({where:{merchantId:f.merchantId,eventType:"shipping.method.selected"}}),0);
  const rows=await prisma.$queryRaw<Array<{n:bigint}>>`SELECT count(*)::bigint AS n FROM cashback_ledger_entries WHERE merchant_id=${f.merchantId} AND type='unreserve'`;
  assert.equal(Number(rows[0]!.n),0);
});

test("CR-SHIP-09 selection releases unbound cashback once and a prepared cashback payment freezes every shipping write",async()=>{
  const f=await fixture("neighborhood"),quote=await f.controller.quote({embedClaims:f.claims},f.body as never);await fund(f);
  await f.controller.select({embedClaims:f.claims},{session_id:f.sessionId,carrier_key:quote.results[0]!.carrier_key,quote_id:quote.id});
  const balance=(await cashback.wallet(f.merchantId,f.buyerId)).balance;assert.equal(balance.reservedCents,0);assert.equal(balance.availableCents,3000);
  const rows=await prisma.$queryRaw<Array<{n:bigint;amount:string}>>`SELECT count(*)::bigint AS n,sum(amount_cents)::text AS amount FROM cashback_ledger_entries WHERE merchant_id=${f.merchantId} AND type='unreserve'`;
  assert.equal(Number(rows[0]!.n),1);assert.equal(rows[0]!.amount,"1500");
  const pending=await fixture("neighborhood"),pendingQuote=await pending.controller.quote({embedClaims:pending.claims},pending.body as never),s=await fund(pending);
  await cashback.preparePayment(s,randomUUID());const before=await sessions.getSession(pending.merchantId,pending.sessionId),wallet=(await cashback.wallet(pending.merchantId,pending.buyerId)).balance;
  await assert.rejects(pending.controller.select({embedClaims:pending.claims},{session_id:pending.sessionId,carrier_key:pendingQuote.results[0]!.carrier_key,quote_id:pendingQuote.id}),/cashback_payment_in_progress/);
  await assert.rejects(pending.controller.quote({embedClaims:pending.claims},pending.body as never),/cashback_payment_in_progress/);
  assert.deepEqual(await sessions.getSession(pending.merchantId,pending.sessionId),before);
  assert.deepEqual((await cashback.wallet(pending.merchantId,pending.buyerId)).balance,wallet);
  assert.equal((await prisma.shippingQuote.findUniqueOrThrow({where:{id:pendingQuote.id}})).selectedCarrierKey,null);
});

test("CR-SHIP-10 stale embed quote publication cannot replace a concurrent checkout snapshot or announce options",async()=>{
  const f=await fixture("neighborhood"),initial=(await sessions.getSession(f.merchantId,f.sessionId))!;
  const original=f.quote.execute.bind(f.quote);
  f.quote.execute=async(...args:Parameters<QuoteShippingUseCase["execute"]>)=>{
    const snapshot=await original(...args);
    await prisma.checkoutSession.update({where:{merchantId_sessionId:{merchantId:f.merchantId,sessionId:f.sessionId}},
      data:{chatHistory:[{role:"buyer",text:"Persisted concurrent turn",occurredAt:new Date().toISOString()}]}});
    return snapshot;
  };
  await assert.rejects(f.controller.quote({embedClaims:f.claims},f.body as never),/CHECKOUT_SESSION_VERSION_CONFLICT/);
  const stored=(await sessions.getSession(f.merchantId,f.sessionId))!;
  assert.equal(stored.persistenceVersion,initial.persistenceVersion!+1);assert.equal(stored.chatHistory![0]!.text,"Persisted concurrent turn");
  assert.equal(stored.shipping,undefined);assert.equal(stored.shippingOptions,undefined);assert.deepEqual(stored.cart,initial.cart);
  assert.equal(await prisma.shippingQuote.count({where:{merchantId:f.merchantId,selectedCarrierKey:{not:null}}}),0);
  assert.equal(await prisma.outboxMessage.count({where:{merchantId:f.merchantId,eventType:"shipping.method.selected"}}),0);
});
