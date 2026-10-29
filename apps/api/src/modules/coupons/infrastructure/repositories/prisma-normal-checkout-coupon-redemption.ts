import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Prisma,type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { readPaymentNormalCrossSellAuthority } from "../../../payment/domain/payment-normal-cross-sell-authority.js";
import { orderTotalCents } from "../../../payment/domain/payment-amount.js";
import { normalCheckoutCouponDiscountOwnerSchema } from "../../domain/contracts/normal-checkout-coupon-owner.schema.js";
import { createCouponEventEnvelope } from "../../domain/events/coupon-domain-event.js";
import { appendOutboxInTransaction } from "../../../../shared/messaging/infrastructure/append-outbox-in-transaction.js";
import { lockCheckoutSessionAnchor } from "../../../../shared/persistence/checkout-session-lock.js";

const ref=normalCheckoutCouponDiscountOwnerSchema.shape.merchantId;
const scopeSchema=z.strictObject({merchantId:ref,eventId:ref});
const sourceSchema=z.object({eventId:ref,eventType:z.literal("order.completed"),schemaVersion:z.literal(1),merchantId:ref,correlationId:ref,
  producer:z.literal("checkout"),payload:z.object({session_id:ref,external_order_id:ref,payment_intent_id:ref,
    normal_coupon_owner:normalCheckoutCouponDiscountOwnerSchema}).passthrough().refine(value=>!("coupon_authority"in value))});
const conflict=():never=>{throw new Error("checkout_coupon_binding_conflict");};
const cents=(value:Prisma.Decimal):number=>{
  if(!Prisma.Decimal.isDecimal(value))return conflict();const amount=value.times(100);
  return amount.isInteger()&&amount.gte(0)&&amount.lte(2_147_483_647)?amount.toNumber():conflict();
};

/** Existing bound-command transport, separate standalone historical branch.
 * Only an immutable persisted order event + approved normal journal can select
 * the exact reservation. No catalog/new eligibility/reprice occurs after paid. */
export async function redeemNormalCheckoutCouponFromOrder(prisma:PrismaClient,raw:unknown):Promise<void>{
  const input=scopeSchema.parse(raw);
  const readSource=(tx:Pick<Prisma.TransactionClient,"outboxMessage">)=>tx.outboxMessage.findFirst({
    where:{merchantId:input.merchantId,eventId:input.eventId,eventType:"order.completed"}});
  const original=sourceSchema.parse(await readSource(prisma)),a=original.payload.normal_coupon_owner;
  if(original.merchantId!==input.merchantId||original.eventId!==input.eventId||a.merchantId!==input.merchantId
    ||a.checkoutSessionId!==original.payload.session_id)return conflict();
  await prisma.$transaction(async tx=>{
    const merchant=z.array(z.object({id:ref})).length(1).parse(await tx.$queryRaw`SELECT id FROM merchants WHERE id=${input.merchantId} FOR UPDATE`);
    if(merchant[0]!.id!==input.merchantId)return conflict();
    await lockCheckoutSessionAnchor(tx,input.merchantId,a.checkoutSessionId);
    await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id=${input.merchantId} AND session_id=${a.checkoutSessionId} FOR UPDATE`;
    const coupons=z.array(z.object({id:ref})).length(1).parse(await tx.$queryRaw`SELECT id FROM coupons WHERE merchant_id=${input.merchantId} AND id=${a.couponId} FOR UPDATE`);
    if(coupons[0]!.id!==a.couponId)return conflict();
    await tx.$queryRaw`SELECT event_id FROM outbox_messages WHERE merchant_id=${input.merchantId} AND event_id=${input.eventId} FOR SHARE`;
    if(!isDeepStrictEqual(sourceSchema.parse(await readSource(tx)),original))return conflict();
    const payment=await tx.paymentIntent.findFirst({where:{id:original.payload.payment_intent_id,merchantId:input.merchantId,sessionId:a.checkoutSessionId},
      select:{id:true,merchantId:true,sessionId:true,status:true,amountCents:true,approvedAmountCents:true,currency:true,method:true,
        providerPaymentId:true,acceptedOfferId:true,creation:true,amountBreakdown:true}});
    if(!payment||payment.id!==original.payload.payment_intent_id||payment.merchantId!==input.merchantId||payment.sessionId!==a.checkoutSessionId
      ||payment.status!=="approved"||payment.providerPaymentId!==original.payload.external_order_id||payment.approvedAmountCents!==payment.amountCents)return conflict();
    const normal=readPaymentNormalCrossSellAuthority(payment);
    if(!normal||normal.frozenProjection.cart.source==="storefront"||normal.frozenProjection.cart.cart_ref!==undefined
      ||!isDeepStrictEqual(normal.discountOwner,a)||normal.amountBreakdown.discountCents!==a.discountCents)return conflict();
    const order=await tx.completedOrder.findFirst({where:{merchantId:input.merchantId,sessionId:a.checkoutSessionId,externalOrderId:original.payload.external_order_id},
      select:{merchantId:true,sessionId:true,externalOrderId:true,orderTotal:true,currency:true}});
    if(!order||order.merchantId!==input.merchantId||order.sessionId!==a.checkoutSessionId||order.externalOrderId!==original.payload.external_order_id
      ||order.currency!==payment.currency||cents(order.orderTotal)!==orderTotalCents(normal.amountBreakdown,payment.amountCents))return conflict();
    await tx.$queryRaw`SELECT event_id FROM outbox_messages WHERE merchant_id=${input.merchantId} AND event_id=${a.applicationEventId} FOR SHARE`;
    const application=await tx.outboxMessage.findFirst({where:{merchantId:input.merchantId,eventId:a.applicationEventId,eventType:"coupon.applied"}});
    const event=z.object({eventId:ref,eventType:z.literal("coupon.applied"),schemaVersion:z.literal(1),merchantId:ref,producer:z.literal("coupons"),payload:z.object({
      session_id:ref,coupon_id:ref,code:ref,redemption_id:ref,reservation_updated_at:z.iso.datetime({offset:true}),discount_applied:z.number().finite().positive()})}).parse(application);
    if(event.eventId!==a.applicationEventId||event.merchantId!==input.merchantId||event.payload.session_id!==a.checkoutSessionId
      ||event.payload.coupon_id!==a.couponId||event.payload.redemption_id!==a.redemptionId||event.payload.code!==a.code
      ||event.payload.reservation_updated_at!==a.reservationUpdatedAt||Math.round(event.payload.discount_applied*100)!==a.discountCents)return conflict();
    const reservation=await tx.couponRedemption.findFirst({where:{id:a.redemptionId,merchantId:input.merchantId,sessionId:a.checkoutSessionId,couponId:a.couponId}});
    if(!reservation||reservation.id!==a.redemptionId||reservation.merchantId!==input.merchantId||reservation.sessionId!==a.checkoutSessionId
      ||reservation.couponId!==a.couponId||reservation.buyerGlobalUserId!==a.reservationBuyerId||cents(reservation.discountApplied)!==a.discountCents)return conflict();
    const receiptId="evt_normal_coupon_"+createHash("sha256").update(JSON.stringify([input.merchantId,a.applicationEventId,a.redemptionId,original.payload.external_order_id])).digest("hex");
    const payload={session_id:a.checkoutSessionId,coupon_id:a.couponId,order_id:original.payload.external_order_id,
      discount_applied:a.discountCents/100,buyer_global_user_id:a.reservationBuyerId??""};
    const readReceipt=()=>tx.outboxMessage.findFirst({where:{merchantId:input.merchantId,eventId:receiptId},
      select:{eventId:true,eventType:true,merchantId:true,payload:true}});
    const expected={eventId:receiptId,eventType:"coupon.redeemed",merchantId:input.merchantId,payload},receipt=await readReceipt();
    if(reservation.status==="redeemed"){
      if(reservation.orderId!==original.payload.external_order_id||!isDeepStrictEqual(receipt,expected))return conflict();return;
    }
    if(reservation.status!=="applied"||reservation.orderId!==null||reservation.updatedAt.toISOString()!==a.reservationUpdatedAt||receipt!==null)return conflict();
    const changed=await tx.couponRedemption.updateMany({where:{id:a.redemptionId,merchantId:input.merchantId,sessionId:a.checkoutSessionId,couponId:a.couponId,
      buyerGlobalUserId:a.reservationBuyerId,discountApplied:reservation.discountApplied,updatedAt:reservation.updatedAt,status:"applied",orderId:null},
      data:{status:"redeemed",orderId:original.payload.external_order_id}});
    if(changed.count!==1)return conflict();
    const usage=await tx.coupon.updateMany({where:{id:a.couponId,merchantId:input.merchantId},data:{usagesCount:{increment:1}}});
    if(usage.count!==1)return conflict();
    await appendOutboxInTransaction(tx,{...createCouponEventEnvelope({eventType:"coupon.redeemed",merchantId:input.merchantId,payload,causationId:input.eventId}),
      event_id:receiptId,correlation_id:original.correlationId});
    if(!isDeepStrictEqual(await readReceipt(),expected))return conflict();
  },{isolationLevel:"ReadCommitted",maxWait:10_000,timeout:15_000});
}
