import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { ConflictException } from "@nestjs/common";
import { CreatePaymentIntentUseCase } from "../application/create-payment-intent.use-case.js";
import { InMemoryCheckoutRepository } from "../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { InMemoryPaymentRepository } from "../infrastructure/in-memory-payment.repository.js";
import { checkoutSession } from "../../checkout/__tests__/checkout-test-fixtures.js";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import { paymentCartFingerprint } from "../../checkout/domain/services/payment-cart-fingerprint.js";
import type { PaymentProviderPort } from "../domain/ports/payment-provider.port.js";
import type { CheckoutSessionRepository } from "../../checkout/domain/ports/checkout-session.repository.port.js";
import type { MerchantRepository } from "../../merchant/domain/ports/merchant-repository.port.js";
import type { CheckoutBenefitsService } from "../../checkout/application/services/checkout-benefits.service.js";
import { toProblemDetails } from "../../../shared/http/problem-details.filter.js";

function fixture(){
  const session=checkoutSession({merchantId:"merchant",sessionId:"checkout",globalUserId:"anonymous-after-detach",persistenceVersion:7,
    customer:{email:"synthetic@example.test",email_verified:false,fullName:"Synthetic",cpf:"12345678901"},
    cart:{currency:"BRL",source:"checkout",total:10,currentDiscount:0,
      items:[{sku:"SKU",name:"Synthetic",variantId:"variant",product_id:"product",price:10,quantity:1,crossSellIntent:{
        version:1,promotionId:"promotion",promotionUpdatedAt:"2026-10-20T12:00:00.000Z",acceptedQuantity:1,originalUnitPriceCents:1100,maximumUnitPriceCents:1000}}]},
    // Re-selecting shipping after detach must not restore verification.
    shipping:{customerPrice:9,carrier:"Synthetic carrier",method:"Synthetic",deliveryDays:1,destinationZip:"01310000",region:"SP"}});
  const calls={identity:0,stock:0,benefits:0,pendingOrder:0,customer:0,provider:0,lookup:0};
  const checkout=new InMemoryCheckoutRepository()as InMemoryCheckoutRepository&CheckoutSessionRepository;
  checkout.saveSession(session);
  let mode:"detached"|"verified"|"missing"|"foreign"|"unavailable"="detached";
  checkout.readVerifiedNormalBuyerIdentity=async(scope,expected)=>{
    calls.identity++;assert.deepEqual(scope,{merchantId:"merchant",sessionId:"checkout"});
    assert.deepEqual(expected,{expectedVersion:7,expectedBuyerId:"anonymous-after-detach"});
    if(mode==="detached")throw Error("checkout_buyer_identity_review_required");
    return mode==="verified"?session.globalUserId:mode==="foreign"?"foreign-buyer":undefined;
  };
  const payments=new InMemoryPaymentRepository();
  const provider={createPayment:async()=>{calls.provider++;throw Error("unexpected_provider_create");},
    createCustomer:async()=>{calls.customer++;return"cus_synthetic";},preparePayment:async()=>{calls.provider++;},
    recoverPayment:async()=>{calls.lookup++;return null;}}as unknown as PaymentProviderPort;
  const prisma={checkoutSession:{findUnique:async()=>({...session,cart:session.cart})},crossStoreLineItem:{findFirst:async()=>null},
    productVariant:{findMany:async()=>{calls.stock++;throw Error("canonical_stock_reached");}}}as unknown as PrismaClient;
  const merchants={getProfile:async()=>{throw Error("unexpected_merchant_provider_lookup");}}as unknown as MerchantRepository;
  const benefits={prepare:async()=>{calls.benefits++;return session;}}as unknown as CheckoutBenefitsService;
  const pending={execute:async()=>{calls.pendingOrder++;throw Error("unexpected_pending_order");}};
  const command=new CreatePaymentIntentUseCase(checkout,merchants,payments,provider,undefined,undefined,pending as never,
    undefined,undefined,undefined,undefined,undefined,prisma,undefined,benefits);
  const body={merchant_id:"merchant",session_id:"checkout",idempotency_key:"same-key",method:"pix"as const};
  return{session,calls,checkout,payments,provider,command,body,mode:(value:typeof mode)=>{mode=value;
    if(value==="unavailable")delete checkout.readVerifiedNormalBuyerIdentity;}};
}
test("detached normal anonymous buyer with shipping restored is refused before any mutation or external preparation",async()=>{
  const f=fixture();await assert.rejects(f.command.execute(f.body),error=>{
    const problem=toProblemDetails(error,"synthetic-correlation");assert.equal(problem.status,409);
    assert.equal(problem.code,"cross_sell_quote_review_required");assert.equal(JSON.stringify(problem).includes("identity_review"),false);return true;
  });
  assert.deepEqual(f.calls,{identity:1,stock:0,benefits:0,pendingOrder:0,customer:0,provider:0,lookup:0});
});
for(const mode of ["missing","foreign","unavailable"]as const)
  test(`normal payment cannot replace actual identity provenance with ${mode}`,async()=>{
    const f=fixture();f.mode(mode);await assert.rejects(f.command.execute(f.body),ConflictException);
    assert.equal(f.calls.stock,0);assert.equal(f.calls.benefits,0);assert.equal(f.calls.pendingOrder,0);assert.equal(f.calls.provider,0);assert.equal(f.calls.customer,0);
  });
test("canonical verified normal identity continues to stock admission without a client verification flag",async()=>{
  const f=fixture();f.mode("verified");await assert.rejects(f.command.execute(f.body),/canonical_stock_reached/);
  assert.equal(f.calls.identity,1);assert.equal(f.calls.stock,1);assert.equal(f.calls.provider,0);
});
test("legacy checkout without normal provenance keeps its existing path",async()=>{
  const f=fixture();delete f.session.cart.items[0]!.crossSellIntent;f.mode("missing");
  f.checkout.saveSession(f.session);
  await assert.rejects(f.command.execute(f.body),/canonical_stock_reached/);assert.equal(f.calls.stock,1);
});
for(const known of [true,false])test(`existing ${known?"known":"uncertain"} intent does not run NEW identity preflight`,async()=>{
  const f=fixture(),amount=2049,breakdown={version:1 as const,currency:"BRL"as const,cartFingerprint:paymentCartFingerprint(f.session),
    itemsSubtotalCents:1000,discountCents:0,shippingCents:900,platformFeeCents:149,totalCents:amount};
  const intent=PaymentIntentEntity.create({merchantId:"merchant",sessionId:"checkout",idempotencyKey:"same-key",amountCents:amount,currency:"BRL",method:"pix",amountBreakdown:breakdown});
  intent.prepareCreation({merchantId:"merchant",sessionId:"checkout",intentId:intent.id,amountCents:amount,currency:"BRL",method:"pix",asaasCustomerId:"cus_synthetic"});
  intent.claimCreation("sent",new Date());
  if(known){intent.completeCreation("sent");intent.markRequiresAction({providerPaymentId:"provider-known"});intent.setBuyerFacingPayload({qrCodeCopyPaste:"synthetic-qr"});}
  else intent.markCreationUncertain("sent","synthetic_ack_unknown");
  await f.payments.saveIntent({intent});
  if(known)await f.command.execute(f.body);else await assert.rejects(f.command.execute(f.body),/payment_creation_uncertain/);
  assert.equal(f.calls.identity,0);assert.equal(f.calls.stock,0);assert.equal(f.calls.provider,0);assert.equal(f.calls.customer,0);
  if(!known)assert.equal(f.calls.lookup,1);
});
