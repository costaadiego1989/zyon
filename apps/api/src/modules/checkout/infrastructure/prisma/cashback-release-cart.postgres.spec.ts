import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";
import { PrismaClient } from "@prisma/client";
import type { AuthorizedOffer, CashbackRules, CheckoutSession } from "@zyon/shared-types";
import { CashbackRepository } from "../../../cashback/infrastructure/cashback.repository.js";
import { CashbackService } from "../../../cashback/application/cashback.service.js";
import { CheckoutCommercialBenefitsService } from "../../../cashback/application/checkout-commercial-benefits.service.js";
import { PrismaCheckoutRepository } from "./prisma-checkout.repository.js";
import { checkoutSession, merchantRules } from "../../__tests__/checkout-test-fixtures.js";
import { ApplyCouponUseCase } from "../../../coupons/application/use-cases/apply-coupon.use-case.js";
import { RulesEngineDiscountAdapter } from "../../../coupons/infrastructure/adapters/rules-engine-discount.adapter.js";

// Only a disposable schema in the explicitly permitted local QA database.
const base="postgresql://cashback:cashback-local-test@127.0.0.1:15433/cashback_seed_qa_compiled";
const schema=`cashback_release_cart_${randomUUID().replaceAll("-","")}`;
const databaseUrl=`${base}?schema=${schema}`;
const bootstrap=new pg.Client({connectionString:base});
const apiRoot=fileURLToPath(new URL("../../../../../",import.meta.url));
let prisma:PrismaClient,cashback:CashbackService,benefits:CheckoutCommercialBenefitsService,repo:PrismaCheckoutRepository;
const rules:CashbackRules={earnRateBps:500,minimumEarnCents:0,maximumEarnPerOrderCents:null,buyerMonthlyEarnLimitCents:null,monthlyBudgetCents:null,
  releaseTrigger:"payment_confirmed",releaseDelayDays:0,expiryDays:null,minimumRedeemOrderCents:0,maximumRedeemBps:9000,maximumRedeemCents:null,allowWithDiscounts:true,
  terms:"QA credito na mesma loja com origem persistida e sem provedor.",combination:{allowCoupons:true,allowAdvancedRules:true,limitMode:"cashback_specific",maximumCombinedDiscountBps:3000,maximumCombinedDiscountCents:null}};
before(async()=>{
  await bootstrap.connect();await bootstrap.query(`CREATE SCHEMA "${schema}"`);
  const require=createRequire(import.meta.url);
  await promisify(execFile)(process.execPath,[require.resolve("prisma/build/index.js"),"db","push","--schema","prisma/schema.prisma","--skip-generate"],{cwd:apiRoot,env:{...process.env,DATABASE_URL:databaseUrl},maxBuffer:1024*1024});
  await bootstrap.query(`SET search_path TO "${schema}"`);
  await bootstrap.query(await readFile(new URL("../../../../../prisma/migrations/20260929020000_checkout_session_write_version/migration.sql",import.meta.url),"utf8"));
  prisma=new PrismaClient({datasources:{db:{url:databaseUrl}}});const cashRepo=new CashbackRepository(prisma);benefits=new CheckoutCommercialBenefitsService(cashRepo);cashback=new CashbackService(cashRepo,benefits);repo=new PrismaCheckoutRepository(prisma,false,undefined,benefits);
});
after(async()=>{await prisma?.$disconnect();await bootstrap.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await bootstrap.end();});

async function fixture(){
  const merchantId=`qa_cash_cart_${randomUUID()}`,sessionId=randomUUID(),buyerId=`qa_cash_buyer_${randomUUID()}`;
  await prisma.merchant.create({data:{id:merchantId,name:"Cashback atomic cart QA"}});
  await prisma.merchantRule.create({data:{merchantId,...merchantRules({maxDiscountPercent:30,minimumMarginPercent:0})}});
  await prisma.buyerAccount.create({data:{globalUserId:buyerId,email:`${buyerId}@cashback.invalid`,displayName:"QA"}});
  await cashback.saveDraft(merchantId,rules,"qa_owner");await cashback.publishProgram(merchantId,"qa_owner",{requireCombination:true});
  const input=checkoutSession({merchantId,sessionId,globalUserId:buyerId,cart:{currency:"BRL",total:100,items:[{sku:"qa-sku",name:"QA",quantity:1,price:100,cost:20,productType:"physical"}]}});
  await repo.saveSession(input);assert.equal(input.persistenceVersion,0);
  await cashback.adjustWallet(merchantId,buyerId,{amountCents:3000,reason:"Credito exclusivo QA",expiryDays:null,idempotencyKey:randomUUID()},"qa_owner");
  const couponId=randomUUID(),redemptionId=randomUUID();
  await prisma.coupon.create({data:{id:couponId,merchantId,code:"QA10",discountType:"fixed",discountValue:10,startsAt:new Date(Date.now()-86400000)}});
  await prisma.couponRedemption.create({data:{id:redemptionId,couponId,merchantId,sessionId,buyerGlobalUserId:buyerId,discountApplied:10,source:"qa"}});
  let s=(await benefits.applyCoupon((await repo.getSession(merchantId,sessionId))!,{redemption_id:redemptionId,discount_applied:10,coupon:{id:couponId,code:"QA10"}}))!;
  const offer:AuthorizedOffer={id:randomUUID(),merchantId,sessionId,type:"discount_fixed",value:5,approved:true,reason:"QA authorized",marginAfterOffer:.7,expiresAt:new Date(Date.now()+3600000).toISOString()};
  s=(await benefits.applyAdvancedRule(s,offer))!;s=(await repo.getSession(merchantId,sessionId))!;
  await cashback.reserveCheckout(s,1500,randomUUID());
  return{s,couponId,redemptionId};
}
function next(s:CheckoutSession,quantity=2):CheckoutSession{return{...structuredClone(s),cart:{...structuredClone(s.cart),items:s.cart.items.map(i=>({...i,quantity})),total:100*quantity,currentDiscount:0,commercialNudge:undefined},shipping:undefined,shippingOptions:undefined,updatedAt:new Date().toISOString()};}
async function effects(s:CheckoutSession){
  const [wallet,journal,events,ledger,redemptions]=await Promise.all([
    cashback.wallet(s.merchantId,s.globalUserId),prisma.$queryRaw`SELECT data,version FROM cashback_checkout_benefits WHERE merchant_id=${s.merchantId} AND session_id=${s.sessionId}`,
    prisma.$queryRaw`SELECT version,data FROM cashback_benefit_events WHERE merchant_id=${s.merchantId} AND session_id=${s.sessionId} ORDER BY version`,
    prisma.$queryRaw`SELECT id,type,amount_cents::text FROM cashback_ledger_entries WHERE merchant_id=${s.merchantId} ORDER BY id`,
    prisma.couponRedemption.findMany({where:{merchantId:s.merchantId},select:{id:true,status:true}})]);
  return{balance:wallet.balance,journal,events,ledger,redemptions};
}

test("CR-CART-01 real write-version trigger and one CAS cart commit release exact reserved credit atomically",async()=>{
  const{s,redemptionId}=await fixture();assert.equal(s.persistenceVersion,2);const before=await effects(s);
  assert.equal(before.balance.reservedCents,1500);assert.equal(before.balance.availableCents,1500);
  const saved=await repo.commitCommercialMutation({expected:s,next:next(s)});
  assert.equal(saved.persistenceVersion,s.persistenceVersion!+1);assert.equal(saved.cart.total,200);assert.equal(saved.cart.items[0]!.quantity,2);assert.equal(saved.cart.currentDiscount,0);assert.equal(saved.cart.commercialBenefitsVersion,3);
  const after=await effects(s);assert.equal(after.balance.availableCents,3000);assert.equal(after.balance.reservedCents,0);
  assert.equal((await prisma.couponRedemption.findUniqueOrThrow({where:{id:redemptionId}})).status,"cancelled");
  const unreserve=await prisma.$queryRaw<Array<{amount:string}>>`SELECT sum(amount_cents)::text AS amount FROM cashback_ledger_entries WHERE merchant_id=${s.merchantId} AND type='unreserve'`;assert.equal(unreserve[0]!.amount,"1500");
  await assert.rejects(prisma.$executeRaw`UPDATE checkout_sessions SET version=version+1 WHERE merchant_id=${s.merchantId} AND session_id=${s.sessionId}`,/CHECKOUT_SESSION_VERSION_READ_ONLY/);
  assert.equal((await repo.getSession(s.merchantId,s.sessionId))!.persistenceVersion,saved.persistenceVersion);
});

test("CR-CART-02 stale CAS rolls back journal reset, coupon cancellation, unreserve ledger and wallet changes",async()=>{
  const{s}=await fixture();await prisma.checkoutSession.update({where:{merchantId_sessionId:{merchantId:s.merchantId,sessionId:s.sessionId}},data:{chatHistory:[{role:"buyer",text:"Concurrent persisted turn",occurredAt:new Date().toISOString()}]}});
  const before=await effects(s),latest=(await repo.getSession(s.merchantId,s.sessionId))!;
  await assert.rejects(repo.commitCommercialMutation({expected:s,next:next(s)}),/CHECKOUT_SESSION_VERSION_CONFLICT/);
  assert.deepEqual(await effects(s),before);assert.deepEqual(await repo.getSession(s.merchantId,s.sessionId),latest);
});

test("CR-CART-03 two workers with one snapshot commit once and never double release the reserved lots",async()=>{
  const{s}=await fixture();const outcomes=await Promise.allSettled([repo.commitCommercialMutation({expected:s,next:next(s,2)}),repo.commitCommercialMutation({expected:s,next:next(s,3)})]);
  assert.equal(outcomes.filter(item=>item.status === "fulfilled").length,1);const actual=(await repo.getSession(s.merchantId,s.sessionId))!;
  assert.equal(actual.persistenceVersion,s.persistenceVersion!+1);assert.ok([200,300].includes(actual.cart.total));assert.equal(actual.cart.commercialBenefitsVersion,3);
  const after=await effects(s);assert.equal(after.balance.availableCents,3000);assert.equal(after.balance.reservedCents,0);
  const rows=await prisma.$queryRaw<Array<{n:bigint;amount:string}>>`SELECT count(*)::bigint AS n,sum(amount_cents)::text AS amount FROM cashback_ledger_entries WHERE merchant_id=${s.merchantId} AND type='unreserve'`;assert.equal(Number(rows[0]!.n),1);assert.equal(rows[0]!.amount,"1500");
});

test("CR-CART-04 prepared or uncertain payment freezes cart, journal, coupon and cashback with no reset",async()=>{
  const{s}=await fixture();await cashback.preparePayment(s,randomUUID());const before=await effects(s),stored=(await repo.getSession(s.merchantId,s.sessionId))!;
  await assert.rejects(repo.commitCommercialMutation({expected:s,next:next(s)}),/cashback_payment_in_progress/);
  assert.deepEqual(await effects(s),before);assert.deepEqual(await repo.getSession(s.merchantId,s.sessionId),stored);assert.equal(before.balance.reservedCents,1500);
});

test("CR-CART-07 dedicated source-coupon form edit retains its real coupon reservation while releasing only unbound cashback",async()=>{
  const suffix=randomUUID(),merchantId=`qa_native_edit_${suffix}`,sessionId=`checkout_${suffix}`,buyerId=`buyer_${suffix}`,cartId=`cart_${suffix}`,productId=`product_${suffix}`,variantId=`variant_${suffix}`;
  await prisma.merchant.create({data:{id:merchantId,name:"QA dedicated source coupon"}});
  await prisma.merchantRule.create({data:{merchantId,...merchantRules({maxDiscountPercent:30,minimumMarginPercent:0,allowStackDiscountAndFreeShipping:true})}});
  await prisma.buyerAccount.create({data:{globalUserId:buyerId,email:`${suffix}@cashback.invalid`,displayName:"QA"}});
  await prisma.product.create({data:{id:productId,merchantId,name:"QA digital",type:"digital",metadata:{}}});
  await prisma.productVariant.create({data:{id:variantId,productId,sku:"NATIVE"}});
  await prisma.productPrice.create({data:{variantId,basePriceInCents:10000,costInCents:2000,currency:"BRL"}});
  await prisma.coupon.create({data:{id:`coupon_${suffix}`,merchantId,code:"NATIVE10",discountType:"fixed",discountValue:10,startsAt:new Date(Date.now()-86400000),endsAt:new Date(Date.now()+86400000)}});
  await prisma.storefrontCart.create({data:{merchantId,sessionId:cartId,total:10000,expiresAt:new Date(Date.now()+86400000),items:[{sku:"NATIVE",variantId,productId,name:"QA digital",unitPriceCents:10000,quantity:1}]}});
  const input=checkoutSession({merchantId,sessionId,globalUserId:buyerId,shipping:undefined,shippingOptions:undefined,customer:{email:`${suffix}@cashback.invalid`,email_verified:true,address:{state:"SP",city:"QA",zip:"01001000"}},
    cart:{currency:"BRL",source:"storefront",cart_ref:cartId,total:100,currentDiscount:0,items:[{sku:"NATIVE",variantId,product_id:productId,name:"QA digital",price:100,cost:20,quantity:1,productType:"digital",fulfillmentStrategy:"digital_delivery"}]}});
  await repo.saveSession(input);await cashback.saveDraft(merchantId,rules,"qa_owner");await cashback.publishProgram(merchantId,"qa_owner",{requireCombination:true});
  await cashback.adjustWallet(merchantId,buyerId,{amountCents:3000,reason:"Credito exclusivo QA",expiryDays:null,idempotencyKey:randomUUID()},"qa_owner");
  const coupons=new ApplyCouponUseCase({}as never,{}as never,new RulesEngineDiscountAdapter(),prisma,undefined,benefits);
  const applied=await coupons.executeForCheckout({merchant_id:merchantId,session_id:sessionId,code:"NATIVE10",expectedVersion:input.persistenceVersion!});
  const expected=(await repo.getSession(merchantId,sessionId))!;assert.equal(expected.cart.currentDiscount,10);
  await cashback.reserveCheckout(expected,1500,randomUUID());
  const changed={...structuredClone(expected),customer:{...structuredClone(expected.customer),address:{...expected.customer!.address,zip:"02002000"}}};
  const saved=await repo.commitCommercialMutation({expected,next:changed});
  assert.equal(saved.persistenceVersion,expected.persistenceVersion!+1);assert.equal(saved.cart.currentDiscount,10);assert.equal(saved.cart.commercialBenefitsVersion,2);assert.equal(saved.customer!.address!.zip,"02002000");
  const source=await prisma.storefrontCart.findUniqueOrThrow({where:{merchantId_sessionId:{merchantId,sessionId:cartId}}});assert.equal(source.couponCode,"NATIVE10");assert.equal(source.discount,1000);
  const coupon=await prisma.couponRedemption.findUniqueOrThrow({where:{id:applied.result.redemption_id}});assert.equal(coupon.status,"applied");assert.equal(coupon.sessionId,cartId);assert.equal(coupon.discountApplied.toNumber(),10);
  const wallet=await cashback.wallet(merchantId,buyerId);assert.equal(wallet.balance.availableCents,3000);assert.equal(wallet.balance.reservedCents,0);
  assert.equal((await cashback.quoteCheckout(saved)).maximumRedeemCents,2000);
});
