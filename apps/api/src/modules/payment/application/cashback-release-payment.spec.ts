import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { CreatePaymentIntentUseCase } from "./create-payment-intent.use-case.js";
import { InMemoryCheckoutRepository } from "../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { InMemoryPaymentRepository } from "../infrastructure/in-memory-payment.repository.js";
import { checkoutSession } from "../../checkout/__tests__/checkout-test-fixtures.js";
import { checkoutScopeReader } from "../../checkout/__tests__/checkout-scope-reader.fixture.js";
import { paymentReviewFingerprint, type PaymentAmountBreakdown } from "../domain/payment-amount.js";
import { ResumePaymentCreationService } from "./resume-payment-creation.service.js";

// Explicit PSP stub. These tests prove dispatch ordering and snapshots only;
// PostgreSQL and HTTP are proved separately by the release integration suite.
async function fixture(cashbackCents=1500, discountCents=1500) {
  const checkout=new InMemoryCheckoutRepository();
  await checkout.saveSession(checkoutSession({customer:{email:"synthetic@example.test",asaasCustomerId:"cus_synthetic"},
    cart:{currency:"BRL",total:100,currentDiscount:discountCents/100,
      items:[{sku:"synthetic",name:"Produto sintético",price:100,quantity:1}]},
    shipping:{customerPrice:15,realCost:15,region:"SP"}}));
  const payments=new InMemoryPaymentRepository(checkout);
  const external:Array<{amountCents:number}>=[],bindings:string[][]=[];
  let failBinding=false,prepareCalls=0;
  const core={preparePayment:async()=>{prepareCalls++;return {cashbackCents,
    reservationId:cashbackCents?"reservation":null,earningQuoteId:cashbackCents?"earning":null};},
    bindPayment:async(...args:string[])=>{if(failBinding)throw Error("cashback_payment_binding_failed");bindings.push(args);}};
  const provider={createPayment:async(input:{amountCents:number})=>{
    if(cashbackCents)assert.ok(bindings.length>0);external.push(input);
    return {providerPaymentId:"psp-stub",status:"requires_action",buyerFacingPayload:{qrCodeCopyPaste:"synthetic-qr"}};
  }};
  const command=new CreatePaymentIntentUseCase(checkout,checkout,payments,provider,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,
    checkoutScopeReader(checkout),undefined,undefined,undefined,undefined,core as never);
  const body={merchant_id:"mrc_1",session_id:"chk_1",idempotency_key:"release-synthetic",method:"pix" as const};
  return {command,body,payments,provider,core,external,bindings,failBinding:(value:boolean)=>{failBinding=value;},prepareCalls:()=>prepareCalls};
}

test("CR-02 CS-03 100 minus coupon 10 rule 5 cashback 15 charges 70 plus freight and fee",async()=>{
  const f=await fixture(),created=await f.command.execute(f.body);
  assert.equal(created.amountCents,8599);assert.equal(f.external[0]!.amountCents,8599);
  assert.deepEqual(created.amountBreakdown&&{items:created.amountBreakdown.itemsSubtotalCents,
    discounts:created.amountBreakdown.discountCents,cashback:created.amountBreakdown.cashbackCents,
    freight:created.amountBreakdown.shippingCents,fee:created.amountBreakdown.platformFeeCents},
    {items:10000,discounts:1500,cashback:1500,freight:1500,fee:99});
  assert.equal(created.amountBreakdown?.cashbackReservationId,"reservation");
  assert.equal(created.amountBreakdown?.cashbackEarningQuoteId,"earning");
  assert.deepEqual(await f.command.execute(f.body),created);
  assert.equal(f.external.length,1);assert.equal(f.prepareCalls(),1);assert.equal(f.bindings.length,2);
});

test("CR-02 CB-14 initial binding failure and same-key retry both forbid a PSP send",async()=>{
  const f=await fixture();f.failBinding(true);
  await assert.rejects(f.command.execute(f.body),/cashback_payment_binding_failed/);
  const persisted=await f.payments.getByIdempotency("mrc_1","chk_1",f.body.idempotency_key);
  assert.equal(persisted?.snapshot().amountCents,8599);assert.equal(persisted?.snapshot().creation?.state,"ready");
  await assert.rejects(f.command.execute(f.body),/cashback_payment_binding_failed/);
  assert.equal(f.external.length,0);assert.equal(f.prepareCalls(),1);
  f.failBinding(false);const recovered=await f.command.execute(f.body);
  assert.equal(recovered.id,persisted?.id);assert.equal(recovered.amountCents,8599);assert.equal(f.external.length,1);
});

test("CR-02 CB-17 disabled cashback preserves the legacy amount and omits cash metadata",async()=>{
  const f=await fixture(0,0),created=await f.command.execute(f.body);
  assert.equal(created.amountCents,11599);assert.equal(f.external[0]!.amountCents,11599);
  assert.equal(Object.hasOwn(created.amountBreakdown!,"cashbackCents"),false);
  assert.equal(f.bindings.length,0);assert.equal(f.external.length,1);
});

test("CR-02 CB-14 direct worker resume cannot send a ready cashback journal before durable binding",async()=>{
  const f=await fixture();f.failBinding(true);
  await assert.rejects(f.command.execute(f.body),/cashback_payment_binding_failed/);
  const payment=(await f.payments.getByIdempotency("mrc_1","chk_1",f.body.idempotency_key))!;
  await assert.rejects(new ResumePaymentCreationService(f.payments,f.provider).execute(payment),/cashback_payment_binding_unavailable/);
  await assert.rejects(new ResumePaymentCreationService(f.payments,f.provider,undefined,undefined,f.core as never).execute(payment),/cashback_payment_binding_failed/);
  assert.equal(f.external.length,0);assert.equal(payment.snapshot().creation?.state,"ready");
  f.failBinding(false);
  const resumed=await new ResumePaymentCreationService(f.payments,f.provider,undefined,undefined,f.core as never).execute(payment);
  assert.equal(resumed.id,payment.id);assert.equal(resumed.amountCents,8599);assert.equal(resumed.status,"requires_action");
  assert.equal(f.external.length,1);assert.equal(f.prepareCalls(),1);
});

test("CR-02 CB-15 review binds cashback identity while retaining the exact legacy V1 digest",()=>{
  const old:PaymentAmountBreakdown={version:1,currency:"BRL",cartFingerprint:"a".repeat(64),itemsSubtotalCents:10000,
    discountCents:1500,shippingCents:1500,platformFeeCents:99,totalCents:10099};
  const legacy=createHash("sha256").update(JSON.stringify(["checkout-payment-review-v1",old.cartFingerprint,
    old.currency,10000,1500,1500,99,10099])).digest("hex");
  assert.equal(paymentReviewFingerprint(old),legacy);
  const cash={...old,cashbackCents:1500,cashbackReservationId:"r1",cashbackEarningQuoteId:"e1",totalCents:8599};
  assert.notEqual(paymentReviewFingerprint(cash),paymentReviewFingerprint({...cash,cashbackReservationId:"r2"}));
  assert.notEqual(paymentReviewFingerprint(cash),paymentReviewFingerprint({...cash,cashbackEarningQuoteId:"e2"}));
});
