import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { checkoutSession } from "../../modules/checkout/__tests__/checkout-test-fixtures.js";
import { checkoutWithCoupon } from "../../modules/coupons/application/services/checkout-coupon.js";
import { readNormalCheckoutCouponOwner } from "./normal-checkout-coupon-owner.js";

function fixture(){
  const now=new Date("2026-10-20T12:00:00.000Z"),calls:string[]=[];
  const session=checkoutWithCoupon(checkoutSession({merchantId:"merchant",sessionId:"checkout",globalUserId:"buyer",
    customer:{email:"synthetic@example.test",email_verified:true,address:{state:"SP",city:"Synthetic",zip:"01310000"}},
    cart:{currency:"BRL",total:47,currentDiscount:0,discountBudget:{version:1,originalSubtotalCents:5000,promotionDiscountCents:300},
      items:[{sku:"A",name:"A",price:47,originalPrice:50,quantity:1}]}}),
    {coupon:{code:"SAVE",discount_type:"fixed"},discount_applied:1});
  const coupon={id:"coupon",merchantId:"merchant",code:"SAVE",strategyIncentiveExecutionId:null,discountType:"fixed",discountValue:new Prisma.Decimal(1),
    minCartTotal:null,maxUsages:5,maxPerBuyer:2,usagesCount:0,allowedSkus:[]as string[],blockedSkus:[]as string[],allowedRegions:[]as string[],blockedRegions:[]as string[],
    status:"active",startsAt:new Date(0),endsAt:null as Date|null,createdAt:now,updatedAt:now};
  const row={id:"reservation",merchantId:"merchant",sessionId:"checkout",couponId:"coupon",buyerGlobalUserId:"buyer"as string|null,
    discountApplied:new Prisma.Decimal(1),status:"applied",orderId:null as string|null,updatedAt:now};
  const event={eventId:"event",eventType:"coupon.applied",schemaVersion:1,merchantId:"merchant",producer:"coupons",payload:{
    session_id:"checkout",coupon_id:"coupon",code:"SAVE",discount_applied:1,source:"manual",redemption_id:"reservation",reservation_updated_at:now.toISOString()}};
  const state={rows:[row],events:[event],count:1,cap:20};let afterLock:(()=>void)|undefined;
  const tx={$queryRaw:async(parts:TemplateStringsArray)=>{const sql=parts.join("?");calls.push(sql);
    if(sql.includes("FROM outbox_messages")){const run=afterLock;afterLock=undefined;run?.();}return sql.includes("FROM coupons")?[{id:"coupon"}]:[];},
    coupon:{findFirst:async()=>coupon},couponRedemption:{findMany:async()=>state.rows,count:async()=>state.count},
    merchantRule:{findUnique:async()=>({merchantId:"merchant",maxDiscountPercent:new Prisma.Decimal(state.cap)})},
    outboxMessage:{findMany:async()=>state.events,findFirst:async()=>state.events[0]??null}}as unknown as Prisma.TransactionClient;
  return{session,coupon,row,event,state,calls,now,afterLock:(work:()=>void)=>{afterLock=work;},read:()=>readNormalCheckoutCouponOwner(tx,session,session.cart,now)};
}
test("standalone coupon owner requires actual scoped reservation and the original generation-bound application event",async()=>{
  const f=fixture(),owner=await f.read();
  assert.deepEqual(owner,{kind:"checkout_coupon",merchantId:"merchant",checkoutSessionId:"checkout",buyerId:"buyer",reservationBuyerId:"buyer",
    couponId:"coupon",redemptionId:"reservation",code:"SAVE",discountCents:100,applicationEventId:"event",reservationUpdatedAt:f.now.toISOString()});
  assert.ok(f.calls[0]!.includes("FOR UPDATE"));assert.ok(f.calls[1]!.includes("FROM coupon_redemptions"));
  assert.ok(f.calls[1]!.includes("ORDER BY id FOR UPDATE"));assert.ok(f.calls.at(-1)!.includes("FOR SHARE"));
});
for(const change of ["tenant","checkout","buyer","coupon","D","cancelled","paid","generation","ambiguous","missing_event","event_scope","event_code","event_D","unverified","source","ceiling","expiry","SKU","quota"])
  test(`standalone coupon owner refuses ${change} without manufacturing another grant`,async()=>{
    const f=fixture();
    if(change==="tenant")f.row.merchantId="foreign";
    if(change==="checkout")f.row.sessionId="foreign";
    if(change==="buyer")f.row.buyerGlobalUserId="foreign";
    if(change==="coupon")f.row.couponId="foreign";
    if(change==="D")f.row.discountApplied=new Prisma.Decimal(2);
    if(change==="cancelled")f.row.status="cancelled";
    if(change==="paid")f.row.orderId="already-paid";
    if(change==="generation")f.event.payload.reservation_updated_at=new Date(0).toISOString();
    if(change==="ambiguous")f.state.events.push(structuredClone(f.event));
    if(change==="missing_event")f.state.events=[];
    if(change==="event_scope")f.event.payload.session_id="foreign";
    if(change==="event_code")f.event.payload.code="FOREIGN";
    if(change==="event_D")f.event.payload.discount_applied=2;
    if(change==="unverified")f.session.customer!.email_verified=false;
    if(change==="source")f.session.cart.source="storefront";
    if(change==="ceiling")f.state.cap=6;
    if(change==="expiry")f.coupon.endsAt=new Date(0);
    if(change==="SKU")f.coupon.allowedSkus=["OTHER"];
    if(change==="quota")f.state.count=6;
    await assert.rejects(f.read());
  });
test("normal standalone coupon does not read analytical cost or margin for eligibility",async()=>{
  const f=fixture();Object.defineProperty(f.coupon,"minimumMarginPercent",{get(){throw Error("analytical_read");}});
  Object.defineProperty(f.session.cart.items[0]!,"cost",{get(){throw Error("analytical_read");}});
  assert.equal((await f.read()).discountCents,100);
});
test("application discovered before a lock wait is reread and cannot donate stale provenance",async()=>{
  const f=fixture();f.afterLock(()=>{f.event.payload.code="CHANGED";});await assert.rejects(f.read());
});
