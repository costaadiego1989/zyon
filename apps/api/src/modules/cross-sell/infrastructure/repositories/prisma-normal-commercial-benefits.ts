import { Prisma, type CheckoutSession as StoredSession } from "@prisma/client";
import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import type { Cart } from "@zyon/shared-types";
import { evaluateCombinedDiscount, moneyCents } from "@zyon/rules-engine";
import { checkoutBenefitsPolicy } from "../../../checkout/domain/services/checkout-benefits-policy.js";
import { toCheckoutSession } from "../../../checkout/domain/services/checkout-session-projection.js";
import { createNormalPolicyBenefitAuthorization, normalCommercialBenefitBasis, normalCommercialRulesForMatching } from "../../../checkout/domain/services/normal-commercial-benefit-proof.js";
import { NORMAL_COMMERCIAL_BENEFIT_EVENT, normalCheckoutBenefitsCommandSchema, normalCheckoutOfferCommandSchema,
  normalCommercialBenefitAuthorizationSchema, type NormalCommercialBenefitAuthorization } from "../../../checkout/domain/contracts/normal-commercial-benefit-proof.schemas.js";
import { normalAcceptedOfferTermsHash, normalCommercialBenefitReview, readNormalCommercialPolicyContext } from "../../../../shared/persistence/normal-checkout-commercial-benefits.js";
import { commercialNotice } from "../../../storefront/domain/services/commercial-notice.js";

/** Only used AFTER the real normal authority reader in the SAME fenced TX.
 * This module never opens transactions, reads body prices or calls commerce. */
interface Current {
  stored: StoredSession; now: Date;
  coupon?: unknown;
  discountOwner?: {kind:string};
  source?: {binding?: {state:string}|null};
}
const refuse = ():never => {throw normalCommercialBenefitReview();};
type WriteVerification = "row"|"scope"|"buyer"|"version"|"strategy"|"cart"|"method";
function refuseWrite(reason:WriteVerification):never{
  const error=normalCommercialBenefitReview();
  Object.defineProperty(error,"normalBenefitWriteVerification",{value:reason,enumerable:false,writable:false});
  throw error;
}
const jsonObject = z.record(z.string(),z.json());
function storageCart(current:Current,cart:Cart):Prisma.InputJsonObject {
  const stored=jsonObject.parse(current.stored.cart);
  return jsonObject.parse(JSON.parse(JSON.stringify({...cart,...(current.source?.binding?.state==="released"
    ?{_storefrontCouponBinding:stored._storefrontCouponBinding}:{})})));
}
function assertVersion(current:Current,expected:number){
  if(current.stored.version!==expected||current.stored.version>=2_147_483_646||current.stored.strategyContextVersion>=2_147_483_646)return refuse();
}
async function save(tx:Prisma.TransactionClient,current:Current,cart:Cart,method?:string,grant?:NormalCommercialBenefitAuthorization){
  const scope={merchantId:current.stored.merchantId,sessionId:current.stored.sessionId};
  const storedCart=storageCart(current,cart);
  const saved=await tx.checkoutSession.updateMany({where:{id:current.stored.id,...scope,globalUserId:current.stored.globalUserId,
    version:current.stored.version,strategyContextVersion:current.stored.strategyContextVersion},data:{cart:storedCart,
    ...(method?{paymentMethod:method}:{}),updatedAt:current.now}});
  if(saved.count!==1)return refuse();
  // Deployed checkout_session_write_version_guard owns every increment. An
  // inferred version is not an ACK; reread the exact scoped DB row in this TX.
  const actual=await tx.checkoutSession.findUnique({where:{merchantId_sessionId:scope}});
  if(!actual)return refuseWrite("row");
  if(actual.id!==current.stored.id||actual.merchantId!==scope.merchantId||actual.sessionId!==scope.sessionId)return refuseWrite("scope");
  if(actual.globalUserId!==current.stored.globalUserId)return refuseWrite("buyer");
  if(actual.version!==current.stored.version+1)return refuseWrite("version");
  if(actual.strategyContextVersion!==current.stored.strategyContextVersion)return refuseWrite("strategy");
  if(!isDeepStrictEqual(actual.cart,storedCart))return refuseWrite("cart");
  if(actual.paymentMethod!==(method??current.stored.paymentMethod))return refuseWrite("method");
  if(grant)await tx.checkoutEvent.create({data:{...scope,eventName:NORMAL_COMMERCIAL_BENEFIT_EVENT,occurredAt:current.now,
    metadata:jsonObject.parse(grant)}});
  return toCheckoutSession(actual);
}
function withDiscount(cart:Cart,discountCents:number,nudge:NonNullable<Cart["commercialNudge"]>,rules:Parameters<typeof evaluateCombinedDiscount>[1]):Cart{
  const decision=evaluateCombinedDiscount(cart,rules,discountCents);
  // A fixed approved offer is never silently clamped to a different amount.
  if(decision.kind!=="authorized"||decision.cartDiscountCents!==discountCents)return refuse();
  // Display metadata only: repeating percentages can cross serde/JSON numeric
  // roundtrips differently. Canonicalize BEFORE persistence, never D/P/cents or
  // any scoped comparison. Financial authorization uses the exact engine D.
  const displayed=nudge.discountPercent===undefined?nudge:{...nudge,
    discountPercent:Number(z.number().finite().min(0).max(100).parse(nudge.discountPercent).toFixed(4))};
  return {...cart,currentDiscount:discountCents/100,commercialNudge:displayed,
    appliedBenefits:[...(cart.appliedBenefits??[]).filter(benefit=>benefit.kind!=="discount"),
      {kind:"discount",label:nudge.title,amount:discountCents/100}],
    ...(decision.remainingDiscountCents===0&&decision.totalDiscountCents>0?{commercialNotices:[commercialNotice("discount_limit_reached")]}:{})};
}
export async function prepareNormalCommercialBenefits(tx:Prisma.TransactionClient,current:Current,cart:Cart,raw:unknown){
  const request=normalCheckoutBenefitsCommandSchema.parse(raw);assertVersion(current,request.expectedVersion);
  const context=await readNormalCommercialPolicyContext(tx,{stored:current.stored,canonicalCart:cart,now:current.now},request.method);
  if(!context.events.some(event=>event.eventName==="payment_method_selected")){
    const event=await tx.checkoutEvent.create({data:{merchantId:current.stored.merchantId,sessionId:current.stored.sessionId,
      eventName:"payment_method_selected",occurredAt:current.now,metadata:{method:request.method,source:"payment_preparation"}}});
    context.events.push({id:event.id,eventName:"payment_method_selected"});
  }
  // Coupon/explicit-offer provenance wins over a generic stage incentive.
  // Their existing reservation/approval is never relabelled as progressive.
  if(current.coupon||current.discountOwner?.kind==="checkout_coupon"||current.discountOwner?.kind==="accepted_offer")
    return {session:await save(tx,current,cart,request.method)};
  const evaluated=checkoutBenefitsPolicy({session:context.session,rules:context.rules,advancedRules:normalCommercialRulesForMatching(context.advancedRules),
    progressivePolicy:context.progressivePolicy,paymentMethod:request.method,events:context.events.map(event=>event.eventName)});
  if(evaluated.couponCode)return {session:await save(tx,current,cart,request.method),couponCode:evaluated.couponCode};
  const grant=createNormalPolicyBenefitAuthorization({...context,method:request.method});
  const previous=moneyCents(cart.currentDiscount??0);if(previous===null)return refuse();
  if(previous>0&&current.stored.paymentMethod!==request.method&&(!grant||grant.discountCents<previous))return refuse();
  if(grant&&grant.discountCents===previous&&current.stored.paymentMethod!==request.method)
    return {session:await save(tx,current,cart,request.method,grant)};
  if(!grant||grant.discountCents<=previous)return {session:await save(tx,current,cart,request.method)};
  const nudge=evaluated.session.cart.commercialNudge;if(!nudge)return refuse();
  const next=withDiscount(cart,grant.discountCents,nudge,context.rules);
  // Shipping has an independent canonical quote/benefit owner; never copy a
  // price reduction produced solely from arbitrary ShippingQuote JSON here.
  return {session:await save(tx,current,next,request.method,grant)};
}

export async function applyNormalCommercialOffer(tx:Prisma.TransactionClient,current:Current,cart:Cart,raw:unknown){
  const request=normalCheckoutOfferCommandSchema.parse(raw);assertVersion(current,request.expectedVersion);
  const context=await readNormalCommercialPolicyContext(tx,{stored:current.stored,canonicalCart:cart,now:current.now});
  const scope={merchantId:current.stored.merchantId,sessionId:current.stored.sessionId};
  if(current.coupon||current.discountOwner?.kind==="checkout_coupon")return refuse();
  await tx.$queryRaw`SELECT id FROM authorized_offers WHERE merchant_id=${scope.merchantId} AND session_id=${scope.sessionId} AND id=${request.offerId} FOR UPDATE`;
  const offer=await tx.authorizedOffer.findFirst({where:{...scope,id:request.offerId}});
  if(!offer||offer.merchantId!==scope.merchantId||offer.sessionId!==scope.sessionId||!offer.approved||offer.expiresAt.getTime()<=current.now.getTime())return refuse();
  const requested=offer.type==="discount_fixed"?moneyCents(offer.value.toNumber()):offer.type==="discount_percent"
    &&offer.value.toNumber()>=0&&offer.value.toNumber()<=100?Math.round(cart.total*offer.value.toNumber()):null;
  const previous=moneyCents(cart.currentDiscount??0);
  if(requested===null||requested<=0||previous===null||requested<previous)return refuse();
  const next=withDiscount(cart,requested,{kind:"advanced_rule",ruleId:offer.id,title:"Oferta aplicada",
    message:"Benefício aprovado pela loja para este pedido.",badge:"Oferta aprovada"},context.rules);
  // Never replace a different accepted owner or manufacture an idempotent
  // result for ambiguous prior acceptance. Exact existing owner may be read.
  const existing=await tx.acceptedOffer.findFirst({where:scope});
  if(existing)return refuse();
  const accepted=await tx.acceptedOffer.create({data:{...scope,offerId:offer.id,type:offer.type,value:offer.value,
    marginAfterOffer:offer.marginAfterOffer,acceptedAt:current.now,expiresAt:offer.expiresAt}});
  const grant=normalCommercialBenefitAuthorizationSchema.parse({version:1,merchantId:scope.merchantId,checkoutSessionId:scope.sessionId,
    buyerId:current.stored.globalUserId,checkoutVersion:current.stored.version+1,
    origin:"accepted_offer",settingsHash:context.settingsHash,stageEventIds:[],basis:normalCommercialBenefitBasis(cart),discountCents:requested,
    offer:{authorizedOfferId:offer.id,acceptedOfferRowId:accepted.id,termsHash:normalAcceptedOfferTermsHash(offer,accepted)}});
  return {session:await save(tx,current,next,undefined,grant),offer:{id:offer.id,type:z.enum(["discount_fixed","discount_percent"]).parse(offer.type),
    value:offer.value.toNumber(),expiresAt:offer.expiresAt.toISOString()}};
}
