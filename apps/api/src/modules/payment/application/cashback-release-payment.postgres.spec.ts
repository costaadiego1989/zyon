import "reflect-metadata";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createServer, type Server } from "node:http";
import pg from "pg";
import { PrismaClient } from "@prisma/client";
import type { AuthorizedOffer, CashbackRules } from "@zyon/shared-types";
import { CashbackRepository } from "../../cashback/infrastructure/cashback.repository.js";
import { CashbackService } from "../../cashback/application/cashback.service.js";
import { CheckoutCommercialBenefitsService } from "../../cashback/application/checkout-commercial-benefits.service.js";
import { PrismaCheckoutRepository } from "../../checkout/infrastructure/prisma/prisma-checkout.repository.js";
import { PrismaMerchantRepository } from "../../merchant/infrastructure/prisma-merchant.repository.js";
import { PrismaPaymentRepository } from "../infrastructure/prisma-payment.repository.js";
import { PrismaPaymentApprovalReader } from "../../checkout/infrastructure/adapters/prisma-payment-approval.reader.js";
import { CreatePaymentIntentUseCase } from "./create-payment-intent.use-case.js";
import { CompleteOrderUseCase } from "../../checkout/application/use-cases/complete-order.use-case.js";
import { RefundPaymentService } from "./services/refund-payment.service.js";
import type { PaymentProviderPort } from "../domain/ports/payment-provider.port.js";

// Entire persistence graph is real PostgreSQL. The PSP is an explicit local
// stub; this transport harness proves HTTP/use-case persistence, not auth/DI.
const databaseUrl="postgresql://cashback:cashback-local-test@127.0.0.1:15433/cashback_seed_qa_compiled";
const schema=`cashback_release_payment_${randomUUID().replaceAll("-","")}`;
const scopedUrl=`${databaseUrl}?schema=${schema}`;
const admin=new pg.Client({connectionString:databaseUrl});
let prisma:PrismaClient;
before(async()=>{
  await admin.connect();await admin.query(`CREATE SCHEMA "${schema}"`);
  const cli=createRequire(import.meta.url).resolve("prisma/build/index.js");
  await promisify(execFile)(process.execPath,[cli,"db","push","--schema","prisma/schema.prisma","--skip-generate"],
    {cwd:fileURLToPath(new URL("../../../../",import.meta.url)),env:{...process.env,DATABASE_URL:scopedUrl},maxBuffer:1024*1024});
  await admin.query(`SET search_path TO "${schema}"`);
  await admin.query(await readFile(new URL("../../../../prisma/migrations/20260929020000_checkout_session_write_version/migration.sql",import.meta.url),"utf8"));
  prisma=new PrismaClient({datasources:{db:{url:scopedUrl}}});
});
after(async()=>{
  await prisma?.$disconnect();
  assert.match(schema,/^cashback_release_payment_[a-f0-9]{32}$/);
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await admin.end();
});
const rules:CashbackRules={earnRateBps:500,minimumEarnCents:0,maximumEarnPerOrderCents:null,buyerMonthlyEarnLimitCents:null,
  monthlyBudgetCents:null,releaseTrigger:"payment_confirmed",releaseDelayDays:0,expiryDays:null,minimumRedeemOrderCents:0,
  maximumRedeemBps:9000,maximumRedeemCents:null,allowWithDiscounts:true,terms:"Crédito promocional QA para esta loja.",
  combination:{allowCoupons:true,allowAdvancedRules:true,limitMode:"cashback_specific",maximumCombinedDiscountBps:3000,maximumCombinedDiscountCents:null}};

async function fixture(){
  const key=randomUUID(),merchantId=`qa-payment-${key}`,buyerId=`qa-buyer-${key}`,sessionId=`qa-checkout-${key}`;
  await prisma.merchant.create({data:{id:merchantId,name:"Loja QA financeira"}});
  await prisma.merchantRule.create({data:{merchantId,maxDiscountPercent:20,minimumMarginPercent:0,allowFreeShipping:false,
    allowShippingDiscount:false,allowBonusItem:false,allowStackDiscountAndFreeShipping:false,couponBoxEnabled:true,
    freeShippingMinCartValue:0,maxShippingSubsidy:0,maxPartialShippingDiscount:0,offerExpirationMinutes:15,blockedRegions:[],brandVoice:"consultative"}});
  await prisma.buyerAccount.create({data:{globalUserId:buyerId,email:`${key}@example.test`,displayName:"Comprador QA"}});
  const product=await prisma.product.create({data:{merchantId,name:"Digital QA",type:"digital",
    metadata:{downloadUrl:"https://example.test/synthetic-download.pdf",downloadExpiryDays:30,digitalDeliveryChannels:["email"]},
    variants:{create:{id:`variant-${key}`,sku:`sku-${key}`}}},include:{variants:true}}),variant=product.variants[0]!;
  const now=new Date();
  await prisma.checkoutSession.create({data:{merchantId,sessionId,globalUserId:buyerId,conversationId:`conversation-${key}`,
    cart:{currency:"BRL",total:100,items:[{sku:variant.sku,variantId:variant.id,product_id:product.id,
      name:"Digital QA",productType:"digital",price:50,cost:10,quantity:2}]},
    customer:{email:`${key}@example.test`,fullName:"Comprador QA",cpf:"12345678901",asaasCustomerId:"cus_synthetic"},
    // Stale physical freight must not enter a digital capture or order.
    shipping:{customerPrice:15,realCost:15,region:"SP"},createdAt:now,updatedAt:now}});
  const checkout=new PrismaCheckoutRepository(prisma),payments=new PrismaPaymentRepository(prisma),merchants=new PrismaMerchantRepository(prisma);
  const repository=new CashbackRepository(prisma),benefits=new CheckoutCommercialBenefitsService(repository),cashback=new CashbackService(repository,benefits);
  await cashback.saveDraft(merchantId,rules,"qa-owner");await cashback.publishProgram(merchantId,"qa-owner");
  await cashback.adjustWallet(merchantId,buyerId,{amountCents:3000,reason:"Crédito de validação",expiryDays:null,idempotencyKey:"initial-credit"},"qa-owner");
  const couponId=`coupon-${key}`,redemptionId=`redemption-${key}`;
  await prisma.coupon.create({data:{id:couponId,merchantId,code:"QA10",discountType:"fixed",discountValue:10,startsAt:new Date(Date.now()-60000)}});
  await prisma.couponRedemption.create({data:{id:redemptionId,couponId,merchantId,sessionId,buyerGlobalUserId:buyerId,discountApplied:10,source:"qa"}});
  let session=(await checkout.getSession(merchantId,sessionId))!;
  session=(await benefits.applyCoupon(session,{redemption_id:redemptionId,discount_applied:10,coupon:{id:couponId,code:"QA10",stackable:true}}))!;
  const offer:AuthorizedOffer={id:`offer-${key}`,merchantId,sessionId,type:"discount_fixed",value:5,approved:true,
    reason:"Condição autorizada QA",marginAfterOffer:0.7,expiresAt:new Date(Date.now()+600000).toISOString()};
  await prisma.authorizedOffer.create({data:{...offer,expiresAt:new Date(offer.expiresAt)}});
  await prisma.acceptedOffer.create({data:{merchantId,sessionId,offerId:offer.id,type:offer.type,value:offer.value,
    marginAfterOffer:offer.marginAfterOffer,acceptedAt:new Date(),expiresAt:new Date(offer.expiresAt)}});
  session=(await benefits.applyAdvancedRule(session,offer))!;
  await cashback.reserveCheckout(session,1500,"reserve-credit");
  const sent:Array<{amountCents:number}>=[],refunds:Array<{amountCents:number}>=[];
  let refundState:"pending"|"succeeded"="succeeded",sendFailure=false;
  const provider:PaymentProviderPort={preparePayment:async input=>input,createPayment:async input=>{
    const quote=await prisma.cashbackEarningQuote.findFirst({where:{merchantId,paymentIntentId:input.intentId}});
    assert.equal(quote?.state,"bound");sent.push(input);
    if(sendFailure)throw Error("synthetic_psp_ack_unknown");
    return {providerPaymentId:`psp-${key}`,status:"requires_action",buyerFacingPayload:{qrCodeCopyPaste:"synthetic-qr"}};
  },recoverPayment:async()=>null,refundPayment:async input=>{refunds.push(input);return {refundId:`refund-${refunds.length}`,status:refundState};},
  fetchRefundStatus:async()=>({state:refundState})};
  const command=new CreatePaymentIntentUseCase(checkout,merchants,payments,provider,undefined,undefined,undefined,undefined,
    checkout,undefined,undefined,undefined,prisma,undefined,undefined,undefined,undefined,cashback);
  const complete=new CompleteOrderUseCase(checkout,checkout,checkout,checkout,undefined,undefined,undefined,checkout,
    undefined,undefined,undefined,undefined,undefined,merchants,undefined,undefined,new PrismaPaymentApprovalReader(prisma),undefined,cashback);
  const refund=new RefundPaymentService(payments,provider,checkout,undefined,cashback);
  const body={merchant_id:merchantId,session_id:sessionId,idempotency_key:"qa-payment",method:"pix" as const};
  return {merchantId,buyerId,sessionId,variant,checkout,payments,cashback,command,complete,refund,body,sent,refunds,
    refundState:(state:typeof refundState)=>{refundState=state;},sendFailure:()=>{sendFailure=true;}};
}

test("CR-02 CB-13/23 real HTTP and full-schema PG bind C10+A5+cash15 before the sole PSP stub send",async()=>{
  const f=await fixture();let server:Server|undefined;
  try{
    server=createServer(async(req,res)=>{try{let raw="";for await(const chunk of req)raw+=chunk;
      const result=await f.command.execute(JSON.parse(raw),{marketplaceSurface:"embed"});res.setHeader("Content-Type","application/json");res.end(JSON.stringify(result));
    }catch(error){res.statusCode=500;res.end(JSON.stringify({error:String(error)}));}});
    await new Promise<void>(resolve=>server!.listen(0,"127.0.0.1",resolve));
    const port=(server.address() as {port:number}).port;
    const post=()=>fetch(`http://127.0.0.1:${port}/intents`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(f.body)});
    const response=await post();const responseBody=await response.text();assert.equal(response.status,200,responseBody);const created=JSON.parse(responseBody) as {id:string;amountCents:number};
    assert.equal(created.amountCents,7099);assert.equal(f.sent[0]!.amountCents,7099);
    const repeated=await post();assert.equal(repeated.status,200);assert.equal((await repeated.json() as {id:string}).id,created.id);assert.equal(f.sent.length,1);
    const payment=(await f.payments.getIntentById(f.merchantId,created.id))!;const snap=payment.snapshot();
    assert.equal(snap.amountBreakdown?.discountCents,1500);assert.equal(snap.amountBreakdown?.cashbackCents,1500);
    assert.equal(snap.amountBreakdown?.shippingCents,0);assert.equal(snap.amountBreakdown?.platformFeeCents,99);
    const quote=await prisma.cashbackEarningQuote.findFirstOrThrow({where:{merchantId:f.merchantId,paymentIntentId:created.id}});
    assert.equal(quote.state,"bound");assert.equal((quote.data as {earnCents:number}).earnCents,350);
    assert.equal((quote.data as {externalCapturedCents:number}).externalCapturedCents,7099);
    assert.equal((await f.cashback.wallet(f.merchantId,f.buyerId)).balance.reservedCents,1500);
    const settlement=await prisma.paymentSettlement.findFirstOrThrow({where:{merchantId:f.merchantId,paymentIntentId:created.id}});
    assert.equal(settlement.plannedGrossCents,7099);
  }finally{if(server)await new Promise<void>((resolve,reject)=>server!.close(error=>error?reject(error):resolve()));}
});

test("CR-02 CB-11 real PG completion grants 350 once; pending partial refund restores only on reconciliation",async()=>{
  const f=await fixture(),created=await f.command.execute(f.body);
  const payment=(await f.payments.getIntentById(f.merchantId,created.id))!;payment.markApproved({providerPaymentId:created.providerPaymentId!,approvedAmountCents:7099});await f.payments.saveIntent({intent:payment});
  const input={merchant_id:f.merchantId,session_id:f.sessionId,external_order_id:created.providerPaymentId!,order_total:70,currency:"BRL"};
  await f.complete.executePaymentApproval(input,created.id);await f.complete.executePaymentApproval(input,created.id);
  const paid=await f.cashback.wallet(f.merchantId,f.buyerId);assert.equal(paid.balance.availableCents,1850);assert.equal(paid.balance.reservedCents,0);
  const ret={merchantId:f.merchantId,externalOrderId:created.providerPaymentId!,returnedItems:[{variantId:f.variant.id,quantity:1}],idempotencyKey:"return:one"};
  f.refundState("pending");const pending=await f.refund.refundOrderPayment(ret);
  assert.equal(pending.amountCents,3500);assert.equal(pending.refunded,false);assert.equal(f.refunds.length,1);
  assert.deepEqual((await f.cashback.wallet(f.merchantId,f.buyerId)).balance,paid.balance);
  f.refundState("succeeded");const reconciled=await f.refund.reconcileRefundPayment({...ret,paymentIntentId:created.id,providerRefundId:pending.providerRefundId!,refundReference:"return:one",amountCents:3500});
  assert.equal(reconciled.state,"succeeded");assert.equal(f.refunds.length,1);
  assert.equal((await f.cashback.wallet(f.merchantId,f.buyerId)).balance.availableCents,2425);
  const final=await f.refund.refundOrderPayment({...ret,idempotencyKey:"return:two"});assert.equal(final.amountCents,3599);assert.equal(final.refunded,true);
  assert.equal(f.refunds.reduce((sum,row)=>sum+row.amountCents,0),7099);
  assert.equal((await f.cashback.wallet(f.merchantId,f.buyerId)).balance.availableCents,3000);
  assert.equal(await prisma.cashbackRefundOperation.count({where:{merchantId:f.merchantId,state:"completed"}}),2);
});

test("CR-02 CB-14 real PG uncertain send pins the original reservation across rule changes and retry",async()=>{
  const f=await fixture();f.sendFailure();await assert.rejects(f.command.execute(f.body),/payment_creation_uncertain/);
  const before=await f.cashback.wallet(f.merchantId,f.buyerId);assert.equal(before.balance.availableCents,1500);assert.equal(before.balance.reservedCents,1500);
  await f.cashback.saveDraft(f.merchantId,{...rules,earnRateBps:9000,combination:{...rules.combination!,allowCoupons:false,maximumCombinedDiscountBps:1000}},"qa-owner");
  await f.cashback.publishProgram(f.merchantId,"qa-owner");await assert.rejects(f.command.execute(f.body),/payment_creation_uncertain/);
  assert.equal(f.sent.length,1);assert.deepEqual((await f.cashback.wallet(f.merchantId,f.buyerId)).balance,before.balance);
  const quote=await prisma.cashbackEarningQuote.findFirstOrThrow({where:{merchantId:f.merchantId}});
  assert.equal((quote.data as {earnCents:number}).earnCents,350);assert.equal((quote.data as {cashbackCents:number}).cashbackCents,1500);
});

test("CR-02 CB-14 real PG missing earning quote refuses initial send and ready-journal retry",async()=>{
  const f=await fixture(),bind=f.cashback.bindPayment.bind(f.cashback);
  f.cashback.bindPayment=async(...args:Parameters<typeof bind>)=>{
    await prisma.cashbackEarningQuote.deleteMany({where:{merchantId:f.merchantId}});
    return bind(...args);
  };
  await assert.rejects(f.command.execute(f.body),/cashback_payment_binding_invalid/);
  await assert.rejects(f.command.execute(f.body),/cashback_payment_binding_invalid/);
  assert.equal(f.sent.length,0);
  const payment=await f.payments.getByIdempotency(f.merchantId,f.sessionId,"qa-payment");
  assert.equal(payment?.snapshot().creation?.state,"ready");assert.equal(payment?.snapshot().amountCents,7099);
  assert.equal((await f.cashback.wallet(f.merchantId,f.buyerId)).balance.reservedCents,1500);
});
