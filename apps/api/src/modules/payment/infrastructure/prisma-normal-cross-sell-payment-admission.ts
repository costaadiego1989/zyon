import type { Prisma } from "@prisma/client";
import type { Cart } from "@zyon/shared-types";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { PaymentIntentSnapshot } from "../domain/payment-intent.entity.js";
import { assertSamePaymentIdentity } from "../domain/payment-persistence.js";
import { readPaymentCouponAuthority } from "../domain/payment-coupon-authority.js";
import { assertNormalCrossSellOwnPaymentForFirstSend, readPaymentNormalCrossSellAuthority } from "../domain/payment-normal-cross-sell-authority.js";
import { normalCheckoutFrozenProjectionSchema, parseNormalCheckoutPaymentAuthority, type NormalCheckoutPaymentAuthority,type NormalCheckoutDiscountOwner } from "../domain/normal-checkout-payment-authority.schemas.js";
import { readBuyerServiceFeeCents } from "./stripe-env.js";
import { requiresPhysicalDelivery } from "../../checkout/domain/services/cart-fulfillment.js";

export interface NormalCrossSellPaymentCurrent{
  stored:{merchantId:string;sessionId:string;version:number;strategyContextVersion:number;globalUserId:string;
    customer?:unknown;shipping?:unknown;paymentMethod?:string|null};
  projectedCart:Cart;acceptanceEventIds:string[];contextHash:string;basisHash:string;now:Date;
  discountOwner?:NormalCheckoutDiscountOwner;
}
type Options={ownPayment:{paymentId:string;version:number}};
export type NormalCrossSellPaymentReader=(tx:Prisma.TransactionClient,scope:{merchantId:string;sessionId:string},options?:Options)=>Promise<NormalCrossSellPaymentCurrent>;
export type CaptureNormalCrossSellPayment=(tx:Prisma.TransactionClient,snapshot:PaymentIntentSnapshot)=>Promise<NormalCheckoutPaymentAuthority>;
const conflict=():never=>{throw new Error("payment_normal_cross_sell_authority_conflict");};
/** The caller owns merchant/config/session fences and this SAME transaction.
 * No provider, retry, principal, catalog stand-in or detached read is created. */
export function createNormalCrossSellPaymentAdmission(readCanonical:NormalCrossSellPaymentReader,
  buyerFee:()=>number=readBuyerServiceFeeCents):CaptureNormalCrossSellPayment{
  return async(tx,snapshot)=>{
    try{
      const original=readPaymentNormalCrossSellAuthority(snapshot),creation=snapshot.creation;
      if(!creation||snapshot.status!=="pending"||snapshot.providerPaymentId||snapshot.currency!=="BRL"||snapshot.commerceOrderId
        ||creation.cancellation||"widgetCheckoutAuthority"in creation||creation.input.marketplaceFunding||creation.input.marketplacePublicAdmission)return conflict();
      const actual=await tx.paymentIntent.findUnique({where:{id:snapshot.id}});
      if(!actual){if(original||(snapshot.version??0)!==0||creation.state!=="ready"||creation.firstAttemptAt)return conflict();}
      else{
        assertNormalCrossSellOwnPaymentForFirstSend(actual,{paymentId:snapshot.id,version:snapshot.version??0,merchantId:snapshot.merchantId,sessionId:snapshot.sessionId});
        if(!original||creation.state!=="in_flight"||!creation.firstAttemptAt)return conflict();
        const stored={...actual,providerPaymentId:actual.providerPaymentId??undefined,acceptedOfferId:actual.acceptedOfferId??undefined,
          commerceOrderId:actual.commerceOrderId??undefined,creation:actual.creation,statusHistory:[]} as unknown as PaymentIntentSnapshot;
        assertSamePaymentIdentity(stored,snapshot);
      }
      const source=await readCanonical(tx,{merchantId:snapshot.merchantId,sessionId:snapshot.sessionId},actual?{ownPayment:{paymentId:actual.id,version:actual.version}}:undefined);
      const stored=source.stored,customer=z.record(z.string(),z.unknown()).parse(stored.customer??{});
      if(stored.merchantId!==snapshot.merchantId||stored.sessionId!==snapshot.sessionId||stored.paymentMethod&&stored.paymentMethod!==snapshot.method)return conflict();
      const cart=source.projectedCart;
      const physical=requiresPhysicalDelivery(cart);
      // Cart's public type intentionally omits private coupon source metadata.
      // Forward these unknown JSON values only into the strict frozen parser;
      // neither this projection nor a cast can grant coupon/shipping authority.
      const couponCode:unknown=Reflect.get(cart,"couponCode"),freeShipping:unknown=Reflect.get(cart,"freeShipping");
      const projection=normalCheckoutFrozenProjectionSchema.parse({globalUserId:stored.globalUserId,cart:{currency:cart.currency,total:cart.total,currentDiscount:cart.currentDiscount??0,
        ...(cart.source===undefined?{}:{source:cart.source}),...(cart.cart_ref===undefined?{}:{cart_ref:cart.cart_ref}),
        ...(couponCode===undefined?{}:{couponCode}),...(freeShipping===undefined?{}:{freeShipping}),
        discountBudget:cart.discountBudget,...(cart.commercialNotices===undefined?{}:{commercialNotices:cart.commercialNotices}),
        items:cart.items.map(item=>({sku:item.sku,variantId:item.variantId,product_id:item.product_id,name:item.name,productType:item.productType,quantity:item.quantity,price:item.price,variant:item.variant,
          ...(item.originalPrice===undefined?{}:{originalPrice:item.originalPrice}),...(item.selected_options===undefined?{}:{selected_options:item.selected_options}),
          ...(item.crossSellIntent===undefined?{}:{crossSellIntent:item.crossSellIntent}),...(item.fulfillmentStrategy===undefined?{}:{fulfillmentStrategy:item.fulfillmentStrategy}),
          ...(item.imageUrl===undefined?{}:{imageUrl:item.imageUrl}),...(item.productUrl===undefined?{}:{productUrl:item.productUrl})}))},
        ...(physical?{shipping:pickShipping(stored.shipping)}:{}),
        customer:{fullName:customer.fullName,email:typeof customer.email==="string"?customer.email.trim().toLowerCase():customer.email,
          cpf:typeof customer.cpf==="string"?customer.cpf.replace(/\D/g,""):customer.cpf,phone:typeof customer.phone==="string"?customer.phone.replace(/\D/g,""):customer.phone,
          email_verified:customer.email_verified,...(physical?{address_verified:customer.address_verified,address:customer.address}:{})}});
      const coupon=readPaymentCouponAuthority(snapshot);
      const owner=source.discountOwner;
      if(projection.cart.currentDiscount>0){
        if(coupon){if(owner||coupon.cartId!==projection.cart.cart_ref||coupon.buyerId!==projection.globalUserId
          ||coupon.discountCents!==snapshot.amountBreakdown?.discountCents)return conflict();}
        else if(!owner)return conflict();
      }else if(owner||coupon)return conflict();
      if(owner?.kind==="accepted_offer"?snapshot.acceptedOfferId!==undefined&&snapshot.acceptedOfferId!==owner.authorizedOfferId:!!snapshot.acceptedOfferId)return conflict();
      if(creation.input.payerEmail!==undefined&&creation.input.payerEmail.trim().toLowerCase()!==projection.customer.email
        ||creation.input.payerName!==undefined&&creation.input.payerName.trim()!==projection.customer.fullName
        ||creation.input.payerIdentification!==undefined&&(creation.input.payerIdentification.type!=="CPF"||creation.input.payerIdentification.number.replace(/\D/g,"")!==projection.customer.cpf)
        ||creation.input.asaasCustomerId!==undefined&&creation.input.asaasCustomerId!==customer.asaasCustomerId)return conflict();
      const captured=parseNormalCheckoutPaymentAuthority({version:1,origin:"normal_checkout_cross_sell",paymentId:snapshot.id,merchantId:snapshot.merchantId,checkoutSessionId:snapshot.sessionId,
        buyerId:stored.globalUserId,checkoutVersion:stored.version,strategyContextVersion:stored.strategyContextVersion,contextHash:source.contextHash,basisHash:source.basisHash,
        acceptanceEventIds:source.acceptanceEventIds,method:snapshot.method,currency:snapshot.currency,amountCents:snapshot.amountCents,amountBreakdown:snapshot.amountBreakdown,
        admittedAt:original?.admittedAt??source.now.toISOString(),frozenProjection:projection,...(owner?{discountOwner:owner}:{})});
      if(captured.amountBreakdown.platformFeeCents!==buyerFee())return conflict();
      readPaymentNormalCrossSellAuthority({...snapshot,creation:{...creation,normalCrossSellAuthority:captured}});
      if(original&&!isDeepStrictEqual(original,captured))return conflict();
      return captured;
    }catch(error){if(error instanceof z.ZodError)return conflict();throw error;}
  };
}
function pickShipping(raw:unknown){
  if(!raw||typeof raw!=="object")return raw;
  const shipping=raw as Record<string,unknown>;
  return {customerPrice:shipping.customerPrice,carrier:shipping.carrier,method:shipping.method,deliveryDays:shipping.deliveryDays,
    destinationZip:shipping.destinationZip,region:shipping.region};
}
