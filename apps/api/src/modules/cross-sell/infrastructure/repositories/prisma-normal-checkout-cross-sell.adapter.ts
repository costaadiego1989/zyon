import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { normalCheckoutCrossSellLegacyEventFields } from "../../domain/events/normal-checkout-cross-sell-event.js";
import { isDeepStrictEqual } from "node:util";
import type { Cart, CheckoutSession } from "@zyon/shared-types";
import { FoodOptionValidationError } from "../../../storefront/domain/food-options.js";
import { commercialNotice } from "../../../storefront/domain/services/commercial-notice.js";
import { storefrontOptionLineIdentity } from "../../../storefront/domain/contracts/storefront-claimed-cart-effect.schemas.js";
import { toCheckoutSession } from "../../../checkout/domain/services/checkout-session-projection.js";
import { stripStoredCheckoutCouponBinding } from "../../../checkout/domain/services/checkout-coupon-storage.js";
import { assertNormalCrossSellCouponAfterWrite, projectNormalCrossSellCouponPresentation } from "../../../../shared/persistence/storefront-coupon/admission.js";
import { StorefrontCouponEligibilityReviewRequired } from "../../../../shared/persistence/storefront-coupon/contracts.js";
import { prepareNormalCommercialBenefits, applyNormalCommercialOffer } from "./prisma-normal-commercial-benefits.js";
import { readNormalCheckoutProductFulfillment, NormalCheckoutProductFulfillmentError } from "../../domain/services/normal-checkout-product-fulfillment.js";
import { normalCheckoutCrossSellScopeSchema, normalCheckoutCrossSellQuoteRequestSchema, normalCheckoutCrossSellAcceptanceSchema,
  normalCheckoutCrossSellQuoteSchema, normalCheckoutCrossSellAcknowledgementSchema } from "../../domain/contracts/normal-checkout-cross-sell-command.schemas.js";
import type { NormalCheckoutCrossSellPort } from "../../domain/ports/normal-checkout-cross-sell.port.js";
import { lockNormalCheckoutCrossSell, readNormalCheckoutCrossSellAuthority, normalCrossSellHash, normalCrossSellEventId,
  normalCrossSellSuggestionSchema, normalCrossSellTargetIntent, normalCrossSellEvidenceSchema,
  normalCrossSellCartMutationSchema, readNormalCrossSellEvidence, requireNormalCrossSellReview } from "./prisma-normal-checkout-cross-sell.authority.js";

const transactionOptions={isolationLevel:"ReadCommitted",maxWait:10_000,timeout:15_000} as const;
type Authority=Awaited<ReturnType<typeof readNormalCheckoutCrossSellAuthority>>;
/** Synchronize the REAL source's BASE representation with checkout's effective
 * projection. No upsert, TTL renewal, detached write or forged source ref. */
async function saveNormalCrossSellSource(tx:Prisma.TransactionClient,current:Authority,cart:Cart){
  if(!current.source)return;
  const {row}=current.source;
  const items=cart.items.map(item=>{
    const projected=current.pricing.items.find(line=>line.variantId===item.variantId&&
      JSON.stringify([line.variantId,(line.selectedOptions??[]).map(option=>option.itemId).sort()])===item.variant)!;
    const input=current.input.lines.find(line=>storefrontOptionLineIdentity(line)===storefrontOptionLineIdentity(projected));
    return {variantId:projected.variantId,productId:projected.productId,sku:projected.sku,name:item.name,quantity:item.quantity,
      unitPriceCents:input?.kind==="preserved_saved"?input.savedUnitPriceCents:projected.baseUnitPriceCents,
      ...(projected.categoryId?{categoryId:projected.categoryId}:{}),...(item.imageUrl?{imageUrl:item.imageUrl}:{}),
      ...(projected.selectedOptions?.length?{selectedOptions:projected.selectedOptions}:{}),
      ...(item.crossSellIntent?{crossSellIntent:item.crossSellIntent}:{})};
  });
  const total=items.reduce((sum,item)=>sum+BigInt(item.unitPriceCents)*BigInt(item.quantity),0n);
  if(total>2_147_483_647n)return requireNormalCrossSellReview("monetary_overflow");
  const saved=await tx.storefrontCart.updateMany({where:{id:row.id,merchantId:row.merchantId,sessionId:row.sessionId,
    items:{equals:row.items as Prisma.InputJsonValue},total:row.total,discount:row.discount,couponCode:row.couponCode,freeShipping:row.freeShipping,
    updatedAt:row.updatedAt,expiresAt:row.expiresAt},data:{items:items as unknown as Prisma.InputJsonValue,total:Number(total),
      discount:current.coupon?current.pricing.cartDiscountCents:row.discount,couponCode:row.couponCode,freeShipping:false,updatedAt:current.now}});
  if(saved.count!==1)return requireNormalCrossSellReview("source_changed");
}
export function projectNormalCrossSellCart(current:Authority):Cart{
  const {commercialNotices:_notices,_storefrontCouponBinding:_binding,...cart}=current.cart;
  const items=current.pricing.items.map(line=>{
    const row=current.rows.find(row=>row.id===line.variantId)!;
    const existing=current.cart.items.find(item=>item.variantId===line.variantId&&
      (item.variant??JSON.stringify([item.variantId,[]]))===JSON.stringify([line.variantId,(line.selectedOptions??[]).map(option=>option.itemId).sort()]));
    const target=current.pricing.targets.find(target=>storefrontOptionLineIdentity(target)===storefrontOptionLineIdentity(line));
    const {originalPrice:_original,crossSellIntent:_intent,selected_options:_options,...base}=existing??{};
    Reflect.deleteProperty(base,"category");
    const fulfillment=readNormalCheckoutProductFulfillment({type:row.product.type,metadata:row.product.metadata},current.now);
    return {...base,sku:line.sku,variantId:line.variantId,product_id:line.productId,productType:fulfillment.productType,
      name:row.product.name,quantity:line.quantity,price:line.unitPriceCents/100,fulfillmentStrategy:fulfillment.fulfillmentStrategy,
      ...(row.product.categoryId?{category:row.product.categoryId}:{}),
      ...(row.weightGrams===null||row.weightGrams===undefined?{}:{weightGrams:row.weightGrams}),
      ...(row.heightCm===null||row.heightCm===undefined?{}:{height_cm:row.heightCm}),
      ...(row.widthCm===null||row.widthCm===undefined?{}:{width_cm:row.widthCm}),
      ...(row.lengthCm===null||row.lengthCm===undefined?{}:{length_cm:row.lengthCm}),
      ...(row.media?.[0]?{imageUrl:row.media[0].url}:{}),
      variant:JSON.stringify([line.variantId,(line.selectedOptions??[]).map(option=>option.itemId).sort()]),
      ...(line.selectedOptions?.length?{selected_options:line.selectedOptions.map(option=>({group_name:option.groupName,item_name:option.itemName,price_modifier:option.priceModifierInCents/100}))}:{}),
      ...(line.unitPriceCents<line.baseUnitPriceCents?{originalPrice:line.baseUnitPriceCents/100}:{}),
      ...(target?{crossSellIntent:normalCrossSellTargetIntent(target)}:existing?.crossSellIntent?{crossSellIntent:existing.crossSellIntent}:{})};
  });
  const projected:Cart={...cart,items,total:current.pricing.merchandiseSubtotalCents/100,currentDiscount:current.pricing.cartDiscountCents/100,
    discountBudget:{version:1,originalSubtotalCents:current.pricing.originalSubtotalCents,promotionDiscountCents:current.pricing.promotionDiscountCents},
    ...(current.pricing.notice?{commercialNotices:[commercialNotice(current.pricing.notice)]}:{})};
  return current.coupon?projectNormalCrossSellCouponPresentation(current.coupon,projected):projected;
}
function storageCart(current:Authority,cart:Cart):Prisma.InputJsonValue{
  return {...cart,...(current.source?.binding?.state==="released"?{_storefrontCouponBinding:current.source.binding}:{})}as unknown as Prisma.InputJsonValue;
}
async function readCommittedNormalVersion(tx:Prisma.TransactionClient,current:Authority){
  const stored=await tx.checkoutSession.findUnique({where:{merchantId_sessionId:{merchantId:current.stored.merchantId,sessionId:current.stored.sessionId}}});
  if(!stored||stored.id!==current.stored.id||stored.merchantId!==current.stored.merchantId||stored.sessionId!==current.stored.sessionId
    ||stored.globalUserId!==current.stored.globalUserId||stored.version!==current.stored.version+1
    ||stored.strategyContextVersion!==current.stored.strategyContextVersion)return requireNormalCrossSellReview("session_changed");
  return stored;
}
/** Deliberately not module/public-wired until session mutation, admission,
 * first-send and frozen-order parity have passed. This writer stores only data
 * its own trusted normal reader can reconstruct; no private-widget receipt. */
export class PrismaNormalCheckoutCrossSellAdapter implements NormalCheckoutCrossSellPort{
  constructor(private readonly prisma:PrismaClient){}
  async prepareBenefits(rawScope:unknown,rawRequest:unknown){
    const scope=normalCheckoutCrossSellScopeSchema.parse(rawScope);
    return this.transaction(async tx=>{
      await lockNormalCheckoutCrossSell(tx,scope);
      const current=await readNormalCheckoutCrossSellAuthority(tx,scope);
      const result=await prepareNormalCommercialBenefits(tx,current,projectNormalCrossSellCart(current),rawRequest);
      const verified=await readNormalCheckoutCrossSellAuthority(tx,scope);
      return {...result,session:toCheckoutSession({...verified.stored,cart:projectNormalCrossSellCart(verified)})};
    });
  }
  async applyOffer(rawScope:unknown,rawRequest:unknown){
    const scope=normalCheckoutCrossSellScopeSchema.parse(rawScope);
    return this.transaction(async tx=>{
      await lockNormalCheckoutCrossSell(tx,scope);
      const current=await readNormalCheckoutCrossSellAuthority(tx,scope);
      const result=await applyNormalCommercialOffer(tx,current,projectNormalCrossSellCart(current),rawRequest);
      const verified=await readNormalCheckoutCrossSellAuthority(tx,scope);
      return {...result,session:toCheckoutSession({...verified.stored,cart:projectNormalCrossSellCart(verified)})};
    });
  }
  private async transaction<T>(body:(tx:Prisma.TransactionClient)=>Promise<T>):Promise<T>{
    try{return await this.prisma.$transaction(body,transactionOptions);}catch(error){
      if(error instanceof NormalCheckoutProductFulfillmentError)return requireNormalCrossSellReview(error.code);
      if(error instanceof z.ZodError||error instanceof FoodOptionValidationError||error instanceof SyntaxError)return requireNormalCrossSellReview("source_invalid");
      if(error instanceof StorefrontCouponEligibilityReviewRequired)return requireNormalCrossSellReview(error.reason);
      if(error instanceof Error&&Object.getPrototypeOf(error)===Error.prototype&&error.message==="checkout_coupon_binding_conflict")return requireNormalCrossSellReview("coupon_owner_required");
      throw error;
    }
  }
  async quote(rawScope:unknown,rawRequest:unknown){
    const scope=normalCheckoutCrossSellScopeSchema.parse(rawScope),request=normalCheckoutCrossSellQuoteRequestSchema.parse(rawRequest);
    return this.transaction(async tx=>{
      await lockNormalCheckoutCrossSell(tx,scope);const current=await readNormalCheckoutCrossSellAuthority(tx,scope,request);
      return normalCheckoutCrossSellQuoteSchema.parse({version:1,...scope,suggestionId:request.suggestion_id,
        sessionVersion:current.stored.version,contextHash:current.contextHash,basisHash:current.basisHash,pricing:current.pricing});
    });
  }
  async accept(rawScope:unknown,rawRequest:unknown){
    const scope=normalCheckoutCrossSellScopeSchema.parse(rawScope),request=normalCheckoutCrossSellAcceptanceSchema.parse(rawRequest);
    if(request.expected_quote.merchantId!==scope.merchantId||request.expected_quote.sessionId!==scope.sessionId)return requireNormalCrossSellReview();
    const requestHash=normalCrossSellHash({suggestion_id:request.suggestion_id,accepted_skus:[...request.accepted_skus].sort(),expected_quote:request.expected_quote});
    return this.transaction(async tx=>{
      await lockNormalCheckoutCrossSell(tx,scope);
      await tx.$queryRaw`SELECT id FROM cross_sell_suggestions WHERE merchant_id=${scope.merchantId} AND session_id=${scope.sessionId} AND id=${request.suggestion_id} FOR UPDATE`;
      const suggestion=normalCrossSellSuggestionSchema.parse(await tx.crossSellSuggestion.findFirst({where:{id:request.suggestion_id,...scope}}));
      if(suggestion.id!==request.suggestion_id||suggestion.merchantId!==scope.merchantId||suggestion.sessionId!==scope.sessionId)return requireNormalCrossSellReview();
      if(suggestion.status==="accepted"){
        const stored=await tx.checkoutSession.findUnique({where:{merchantId_sessionId:scope}});
        if(!stored||stored.merchantId!==scope.merchantId||stored.sessionId!==scope.sessionId)return requireNormalCrossSellReview();
        const evidence=await readNormalCrossSellEvidence(tx,scope,suggestion,stored.globalUserId);
        if(evidence.requestHash!==requestHash)return requireNormalCrossSellReview("request_conflict");
        return evidence.ack;
      }
      const quoteRequest={suggestion_id:request.suggestion_id,targets:request.expected_quote.pricing.targets.map(target=>({sku:target.sku,
        variant_id:target.variantId,quantity:target.acceptedQuantity,selected_option_item_ids:target.selectedOptionItemIds??[]}))};
      const current=await readNormalCheckoutCrossSellAuthority(tx,scope,quoteRequest);
      const quote=normalCheckoutCrossSellQuoteSchema.parse({version:1,...scope,suggestionId:request.suggestion_id,sessionVersion:current.stored.version,
        contextHash:current.contextHash,basisHash:current.basisHash,pricing:current.pricing});
      if(!isDeepStrictEqual(quote,request.expected_quote)||current.stored.strategyContextVersion>=2_147_483_647)return requireNormalCrossSellReview("quote_changed");
      const ack=normalCheckoutCrossSellAcknowledgementSchema.parse({version:1,status:"accepted",...scope,suggestionId:request.suggestion_id,
        persistenceVersion:current.stored.version+1,quoteHash:normalCrossSellHash(quote)});
      const eventId=normalCrossSellEventId(scope,request.suggestion_id);
      const payload=normalCrossSellEvidenceSchema.parse({protocol:"normal_checkout_cross_sell_v1",buyerId:current.stored.globalUserId,requestHash,quote,ack,
        ...normalCheckoutCrossSellLegacyEventFields(quote)});
      const resolved=await tx.crossSellSuggestion.updateMany({where:{id:suggestion.id,...scope,status:"pending",promoId:suggestion.promoId},data:{status:"accepted",resolvedAt:current.now}});
      if(resolved.count!==1)return requireNormalCrossSellReview("suggestion_changed");
      const projectedCart=projectNormalCrossSellCart(current);
      await saveNormalCrossSellSource(tx,current,projectedCart);
      const saved=await tx.checkoutSession.updateMany({where:{id:current.stored.id,...scope,version:current.stored.version,
        strategyContextVersion:current.stored.strategyContextVersion,globalUserId:current.stored.globalUserId},data:{
          cart:storageCart(current,projectedCart),shipping:Prisma.DbNull,shippingOptions:Prisma.DbNull,updatedAt:current.now}});
      if(saved.count!==1)return requireNormalCrossSellReview("session_changed");
      await readCommittedNormalVersion(tx,current);
      await tx.checkoutEvent.create({data:{...scope,eventName:"cross_sell_accepted",occurredAt:current.now,
        metadata:{suggestion_id:suggestion.id,acceptance_event_id:eventId,checkout_version:ack.persistenceVersion}}});
      if(current.coupon)await assertNormalCrossSellCouponAfterWrite(tx,current.coupon);
      await tx.outboxMessage.create({data:{eventId,eventType:"cross-sell.offer.accepted",schemaVersion:1,merchantId:scope.merchantId,
        occurredAt:current.now,correlationId:eventId,causationId:suggestion.id,producer:"cross-sell",payload:payload as unknown as Prisma.InputJsonValue}});
      return ack;
    });
  }
  async read(rawScope:unknown,expected?:CheckoutSession):Promise<CheckoutSession>{
    const scope=normalCheckoutCrossSellScopeSchema.parse(rawScope);
    return this.transaction(async tx=>{
      await lockNormalCheckoutCrossSell(tx,scope);const current=await readNormalCheckoutCrossSellAuthority(tx,scope);
      if(expected&&(expected.merchantId!==scope.merchantId||expected.sessionId!==scope.sessionId||expected.globalUserId!==current.stored.globalUserId
        ||expected.persistenceVersion!==current.stored.version||!isDeepStrictEqual(expected.cart,stripStoredCheckoutCouponBinding(current.cart))))return requireNormalCrossSellReview("snapshot_changed");
      return toCheckoutSession({...current.stored,cart:projectNormalCrossSellCart(current)});
    });
  }
  async updateCart(rawScope:unknown,rawRequest:unknown):Promise<CheckoutSession>{
    const scope=normalCheckoutCrossSellScopeSchema.parse(rawScope),request=normalCrossSellCartMutationSchema.parse(rawRequest);
    return this.transaction(async tx=>{
      await lockNormalCheckoutCrossSell(tx,scope);
      const current=await readNormalCheckoutCrossSellAuthority(tx,scope,undefined,{mutation:request});
      const cart=projectNormalCrossSellCart(current);
      if(isDeepStrictEqual(current.cart.items,current.originalCart.items))return toCheckoutSession({...current.stored,cart});
      if(current.stored.strategyContextVersion>=2_147_483_647)return requireNormalCrossSellReview("snapshot_changed");
      await saveNormalCrossSellSource(tx,current,cart);
      const saved=await tx.checkoutSession.updateMany({where:{id:current.stored.id,...scope,version:current.stored.version,
        strategyContextVersion:current.stored.strategyContextVersion,globalUserId:current.stored.globalUserId},data:{
          cart:storageCart(current,cart),shipping:Prisma.DbNull,shippingOptions:Prisma.DbNull,updatedAt:current.now}});
      if(saved.count!==1)return requireNormalCrossSellReview("session_changed");
      const committed=await readCommittedNormalVersion(tx,current);
      await tx.checkoutEvent.create({data:{...scope,eventName:"cart_updated",occurredAt:current.now,
        metadata:{source:"normal_checkout_cross_sell",previous_version:current.stored.version,checkout_version:current.stored.version+1}}});
      if(current.coupon)await assertNormalCrossSellCouponAfterWrite(tx,current.coupon);
      return toCheckoutSession({...committed,cart,shipping:null,shippingOptions:null});
    });
  }
}
