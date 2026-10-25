import assert from "node:assert/strict";
import test from "node:test";
import { Prisma,type PrismaClient } from "@prisma/client";
import { normalPaymentAuthorityFixture } from "../../../payment/domain/normal-checkout-payment.fixture.js";
import { paymentCartFingerprint } from "../../../checkout/domain/services/payment-cart-fingerprint.js";
import { redeemNormalCheckoutCouponFromOrder } from "./prisma-normal-checkout-coupon-redemption.js";

function fixture(){
  const f=normalPaymentAuthorityFixture(),now=new Date("2026-10-20T12:00:00.000Z");
  const owner={kind:"checkout_coupon"as const,merchantId:"merchant",checkoutSessionId:"checkout",buyerId:"buyer",reservationBuyerId:"buyer",
    couponId:"coupon",redemptionId:"redemption",code:"SAVE",discountCents:100,applicationEventId:"application",reservationUpdatedAt:now.toISOString()};
  f.authority.discountOwner=owner;f.authority.frozenProjection.cart.currentDiscount=1;f.authority.amountCents-=100;
  Object.assign(f.authority.amountBreakdown,{discountCents:100,totalCents:f.authority.amountCents,
    cartFingerprint:paymentCartFingerprint(f.authority.frozenProjection)});
  const payment={...f.scope,status:"approved",acceptedOfferId:null,providerPaymentId:"provider-order",amountCents:f.authority.amountCents,
    approvedAmountCents:f.authority.amountCents,creation:{...f.scope.creation,input:{...f.scope.creation.input,amountCents:f.authority.amountCents}}};
  const source={eventId:"source",merchantId:"merchant",eventType:"order.completed",schemaVersion:1,producer:"checkout",correlationId:"correlation",
    payload:{session_id:"checkout",external_order_id:"provider-order",payment_intent_id:"payment",normal_coupon_owner:structuredClone(owner)}};
  const application={eventId:"application",merchantId:"merchant",eventType:"coupon.applied",schemaVersion:1,producer:"coupons",
    payload:{session_id:"checkout",coupon_id:"coupon",code:"SAVE",redemption_id:"redemption",reservation_updated_at:now.toISOString(),discount_applied:1}};
  const row={id:"redemption",merchantId:"merchant",sessionId:"checkout",couponId:"coupon",buyerGlobalUserId:"buyer",discountApplied:new Prisma.Decimal(1),
    status:"applied",orderId:null as string|null,updatedAt:now};
  const state={row,payment:payment as typeof payment|null,order:{merchantId:"merchant",sessionId:"checkout",externalOrderId:"provider-order",
    currency:"BRL",orderTotal:new Prisma.Decimal((f.authority.amountCents-149)/100)},usage:0,
    outbox:[source,application]as Array<Record<string,unknown>>,writes:[]as string[],fail:""};
  const tx={$queryRaw:async(parts:TemplateStringsArray)=>parts.join("?").includes("FROM merchants")?[{id:"merchant"}]:[{id:"coupon"}],
    paymentIntent:{findFirst:async()=>state.payment},completedOrder:{findFirst:async()=>state.order},
    couponRedemption:{findFirst:async()=>state.row,updateMany:async()=>{state.writes.push("reservation");if(state.fail==="cas")return{count:0};
      Object.assign(state.row,{status:"redeemed",orderId:"provider-order",updatedAt:new Date("2026-10-20T13:00:00.000Z")});return{count:1};}},
    coupon:{updateMany:async()=>{state.writes.push("usage");state.usage++;return{count:1};}},
    outboxMessage:{findFirst:async({where,select}:{where:{eventId:string};select?:Record<string,boolean>})=>{
      const row=state.outbox.find(row=>row.eventId===where.eventId);return row?(select?Object.fromEntries(Object.keys(select).map(key=>[key,row[key]])):row):null;},
      upsert:async({create}:{create:Record<string,unknown>})=>{if(state.fail==="outbox")throw Error("synthetic_outbox_failure");state.writes.push("outbox");state.outbox.push(create);return create;}}};
  const prisma={...tx,$transaction:async(body:(tx:typeof tx)=>Promise<void>)=>{const before={row:{...state.row},usage:state.usage,outbox:[...state.outbox]};
    try{return await body(tx);}catch(error){Object.assign(state,before);throw error;}}}as unknown as PrismaClient;
  return{owner,source,application,state,run:()=>redeemNormalCheckoutCouponFromOrder(prisma,{merchantId:"merchant",eventId:"source"})};
}
test("normal standalone consumer redeems the exact frozen coupon once and preserves replay after updatedAt changes",async()=>{
  const f=fixture();await f.run();assert.equal(f.state.row.status,"redeemed");assert.equal(f.state.row.orderId,"provider-order");
  assert.equal(f.state.usage,1);assert.deepEqual(f.state.writes,["reservation","usage","outbox"]);
  f.state.writes=[];await f.run();assert.equal(f.state.usage,1);assert.deepEqual(f.state.writes,[]);
});
for(const change of ["missing_journal","unapproved","journal_owner","order_money","application_scope","application_generation","reservation_scope","reservation_D","reservation_buyer","cancelled","reapplied_generation","both_owners"])
  test(`normal coupon historical consumption rejects ${change} before writes`,async()=>{
    const f=fixture();
    if(change==="missing_journal")f.state.payment=null;
    if(change==="unapproved")f.state.payment!.status="pending";
    if(change==="journal_owner"){const owner=f.state.payment!.creation.normalCrossSellAuthority.discountOwner;
      assert.equal(owner?.kind,"checkout_coupon");if(owner?.kind==="checkout_coupon")owner.redemptionId="foreign";}
    if(change==="order_money")f.state.order.orderTotal=new Prisma.Decimal(1);
    if(change==="application_scope")f.application.payload.session_id="foreign";
    if(change==="application_generation")f.application.payload.reservation_updated_at=new Date(0).toISOString();
    if(change==="reservation_scope")f.state.row.sessionId="foreign";
    if(change==="reservation_D")f.state.row.discountApplied=new Prisma.Decimal(2);
    if(change==="reservation_buyer")f.state.row.buyerGlobalUserId="foreign";
    if(change==="cancelled")f.state.row.status="cancelled";
    if(change==="reapplied_generation")f.state.row.updatedAt=new Date(0);
    if(change==="both_owners")Reflect.set(f.source.payload,"coupon_authority",{});
    await assert.rejects(f.run());assert.equal(f.state.usage,0);assert.deepEqual(f.state.writes,[]);
  });
for(const fault of ["cas","outbox"])
  test(`normal coupon ${fault} fault rolls reservation/usage/outbox back`,async()=>{
    const f=fixture();f.state.fail=fault;await assert.rejects(f.run());assert.equal(f.state.row.status,"applied");
    assert.equal(f.state.usage,0);assert.equal(f.state.outbox.length,2);
  });
