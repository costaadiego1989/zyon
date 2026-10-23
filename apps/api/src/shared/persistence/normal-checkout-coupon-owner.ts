import { Prisma } from "@prisma/client";
import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import type { Cart, CheckoutSession } from "@zyon/shared-types";
import { evaluateCombinedDiscount, moneyCents } from "@zyon/rules-engine";
import { normalCheckoutCouponDiscountOwnerSchema, type NormalCheckoutCouponDiscountOwner } from "../../modules/coupons/domain/contracts/normal-checkout-coupon-owner.schema.js";
import { toCouponEntity } from "../../modules/coupons/infrastructure/repositories/prisma-coupon.converters.js";
import { validateCoupon } from "../../modules/coupons/domain/policies/coupon-validity.policy.js";
import { calculateCouponDiscount } from "../../modules/coupons/domain/policies/coupon-discount-calculator.js";

const ref=normalCheckoutCouponDiscountOwnerSchema.shape.merchantId;
const conflict=():never=>{throw new Error("normal_checkout_coupon_review_required");};
const reservationSchema=z.object({id:ref,merchantId:ref,sessionId:ref,couponId:ref,buyerGlobalUserId:ref.nullable(),
  discountApplied:z.custom<Prisma.Decimal>(Prisma.Decimal.isDecimal),status:z.literal("applied"),orderId:z.null(),updatedAt:z.date()});
const applicationSchema=z.object({eventId:ref,eventType:z.literal("coupon.applied"),schemaVersion:z.literal(1),merchantId:ref,
  producer:z.literal("coupons"),payload:z.object({session_id:ref,coupon_id:ref,code:ref,discount_applied:z.number().finite().positive(),
    source:z.enum(["manual","auto"]),redemption_id:ref,reservation_updated_at:z.iso.datetime({offset:true})})});

/** Standalone normal checkout only. Caller owns merchant/config/session locks.
 * Actual current rows + generation-bound original application event are required;
 * neither nudge, references nor a stored payment sibling grants eligibility. */
export async function readNormalCheckoutCouponOwner(tx:Prisma.TransactionClient,
  session:CheckoutSession,canonicalCart:Cart,now:Date):Promise<NormalCheckoutCouponDiscountOwner>{
  const scope={merchantId:session.merchantId,sessionId:session.sessionId};
  if(canonicalCart.source==="storefront"||canonicalCart.cart_ref!==undefined||!ref.safeParse(session.globalUserId).success
    ||!(now instanceof Date)||!Number.isFinite(now.getTime()))return conflict();
  const nudge=canonicalCart.commercialNudge,discountCents=moneyCents(canonicalCart.currentDiscount??0);
  if(!nudge||nudge.kind!=="coupon"||!ref.safeParse(nudge.couponCode).success||!discountCents||discountCents<0)return conflict();
  if(!(session.customer?.email_verified===true&&Boolean(session.customer.email?.trim())
    ||session.customer?.phone_verified===true&&Boolean(session.customer.phone?.replace(/\D/g,""))))return conflict();
  const locked=z.array(z.object({id:ref})).length(1).parse(await tx.$queryRaw`SELECT id FROM coupons WHERE merchant_id=${scope.merchantId}
    AND code=${nudge.couponCode} FOR UPDATE`);
  const actual=await tx.coupon.findFirst({where:{merchantId:scope.merchantId,id:locked[0]!.id,code:nudge.couponCode}});
  if(!actual||actual.merchantId!==scope.merchantId||actual.id!==locked[0]!.id)return conflict();
  const coupon=toCouponEntity(actual).snapshot();
  if(coupon.strategy_incentive_execution_id||!["fixed","percent"].includes(coupon.discount_type))return conflict();
  await tx.$queryRaw`SELECT id FROM coupon_redemptions WHERE merchant_id=${scope.merchantId} AND session_id=${scope.sessionId}
    AND status<>'cancelled' ORDER BY id FOR UPDATE`;
  const rows=z.array(reservationSchema).length(1).parse(await tx.couponRedemption.findMany({
    where:{...scope,status:{not:"cancelled"}},take:2}));
  const row=rows[0]!;
  const cents=row.discountApplied.times(100);
  if(row.merchantId!==scope.merchantId||row.sessionId!==scope.sessionId||row.couponId!==coupon.id
    ||row.buyerGlobalUserId!==session.globalUserId||!cents.isInteger()||!cents.eq(discountCents))return conflict();
  const region=session.customer?.address?.state?.trim().toUpperCase();
  if(!region&&(coupon.allowed_regions.length||coupon.blocked_regions.length)
    ||!validateCoupon(coupon,canonicalCart,region,now).valid
    ||(moneyCents(calculateCouponDiscount(coupon,canonicalCart.total))??-1)<discountCents)return conflict();
  const policy=await tx.merchantRule.findUnique({where:{merchantId:scope.merchantId},select:{merchantId:true,maxDiscountPercent:true}});
  if(!policy||policy.merchantId!==scope.merchantId||!Prisma.Decimal.isDecimal(policy.maxDiscountPercent))return conflict();
  const combined=evaluateCombinedDiscount(canonicalCart,{maxDiscountPercent:policy.maxDiscountPercent.toNumber()},discountCents);
  if(combined.kind!=="authorized"||combined.cartDiscountCents!==discountCents)return conflict();
  if(coupon.max_usages!==null&&await tx.couponRedemption.count({where:{merchantId:scope.merchantId,couponId:coupon.id,status:{not:"cancelled"}}})>coupon.max_usages
    ||coupon.max_per_buyer!==null&&await tx.couponRedemption.count({where:{merchantId:scope.merchantId,couponId:coupon.id,
      buyerGlobalUserId:session.globalUserId,status:{not:"cancelled"}}})>coupon.max_per_buyer)return conflict();
  if(canonicalCart.appliedBenefits?.length!==1||canonicalCart.appliedBenefits[0]?.kind!=="discount"
    ||moneyCents(canonicalCart.appliedBenefits[0].amount)!==discountCents)return conflict();
  // Query exact generation so a prior cancelled/reapplied event cannot donate
  // identity to this reservation. Ambiguous legacy events stay review-only.
  const events=z.array(applicationSchema).length(1).parse(await tx.outboxMessage.findMany({where:{merchantId:scope.merchantId,
    producer:"coupons",eventType:"coupon.applied",AND:[{payload:{path:["session_id"],equals:scope.sessionId}},
      {payload:{path:["redemption_id"],equals:row.id}},{payload:{path:["reservation_updated_at"],equals:row.updatedAt.toISOString()}}]},take:2}));
  const event=events[0]!,payload=event.payload;
  if(event.merchantId!==scope.merchantId||payload.session_id!==scope.sessionId||payload.coupon_id!==coupon.id||payload.code!==coupon.code
    ||payload.redemption_id!==row.id||payload.reservation_updated_at!==row.updatedAt.toISOString()
    ||moneyCents(payload.discount_applied)!==discountCents)return conflict();
  await tx.$queryRaw`SELECT event_id FROM outbox_messages WHERE merchant_id=${scope.merchantId} AND event_id=${event.eventId} FOR SHARE`;
  const reread=applicationSchema.parse(await tx.outboxMessage.findFirst({where:{merchantId:scope.merchantId,eventId:event.eventId,eventType:"coupon.applied"}}));
  if(!isDeepStrictEqual(reread,event))return conflict();
  return normalCheckoutCouponDiscountOwnerSchema.parse({kind:"checkout_coupon",merchantId:scope.merchantId,checkoutSessionId:scope.sessionId,
    buyerId:session.globalUserId,reservationBuyerId:row.buyerGlobalUserId,couponId:coupon.id,redemptionId:row.id,code:coupon.code,
    discountCents,applicationEventId:event.eventId,reservationUpdatedAt:row.updatedAt.toISOString()});
}
