import { z } from "zod";
import { moneyCents } from "@zyon/rules-engine";
import { paymentCartFingerprint } from "../../checkout/domain/services/payment-cart-fingerprint.js";
import { checkoutExplicitAddressSchema } from "../../checkout/domain/services/checkout-explicit-address.schema.js";
import { requiresPhysicalDelivery } from "../../checkout/domain/services/cart-fulfillment.js";
import { crossSellAcceptedLineIntentSchema } from "../../cross-sell/domain/contracts/cross-sell-storefront-quote.schemas.js";
import { commercialNoticesSchema } from "../../storefront/domain/contracts/commercial-notice.schemas.js";
import { normalCheckoutCouponDiscountOwnerSchema } from "../../coupons/domain/contracts/normal-checkout-coupon-owner.schema.js";
import { normalCheckoutPolicyDiscountOwnerSchema,normalCheckoutAcceptedOfferDiscountOwnerSchema } from "../../checkout/domain/contracts/normal-commercial-benefit-proof.schemas.js";

export const normalCheckoutDiscountOwnerSchema=z.discriminatedUnion("kind",[
  normalCheckoutCouponDiscountOwnerSchema,normalCheckoutPolicyDiscountOwnerSchema,normalCheckoutAcceptedOfferDiscountOwnerSchema]);
export type NormalCheckoutDiscountOwner=z.infer<typeof normalCheckoutDiscountOwnerSchema>;

const ref=z.string().min(1).max(200).refine(value=>value.trim()===value&&!/[\u0000-\u001f\u007f]/.test(value));
const cents=z.number().int().min(0).max(2_147_483_647),hash=z.string().regex(/^[a-f0-9]{64}$/);
const money=z.number().finite().nonnegative().refine(value=>{const parsed=moneyCents(value);return parsed!==null&&parsed<=2_147_483_647;});
const line=z.strictObject({sku:ref,variantId:ref,product_id:ref,name:z.string().min(1).max(1000),productType:z.enum(["physical","food","digital","service"]),
  quantity:z.number().int().min(1).max(99),price:money,originalPrice:money.optional(),variant:z.string().min(1).max(65536),
  selected_options:z.array(z.strictObject({group_name:z.string().max(1000),item_name:z.string().max(1000),price_modifier:money})).max(250).optional(),
  crossSellIntent:crossSellAcceptedLineIntentSchema.optional(),fulfillmentStrategy:z.enum(["carrier","pickup","local_delivery","digital","service"]).optional(),
  imageUrl:z.string().max(2048).optional(),productUrl:z.string().max(2048).optional()}).superRefine((value,ctx)=>{
  const compatible=value.productType==="digital"?value.fulfillmentStrategy==="digital"
    :value.productType==="service"?value.fulfillmentStrategy==="service"
    :value.fulfillmentStrategy===undefined||["carrier","pickup","local_delivery"].includes(value.fulfillmentStrategy);
  if(!compatible)ctx.addIssue({code:"custom",message:"normal_payment_fulfillment_inconsistent"});
});
const cart=z.strictObject({currency:z.literal("BRL"),total:money,currentDiscount:money,source:z.enum(["checkout","storefront"]).optional(),
  cart_ref:ref.optional(),couponCode:ref.nullish(),freeShipping:z.literal(false).optional(),items:z.array(line).min(1).max(200),
  discountBudget:z.strictObject({version:z.literal(1),originalSubtotalCents:cents,promotionDiscountCents:cents}),commercialNotices:commercialNoticesSchema.optional(),
}).superRefine((value,ctx)=>{
  const effective=value.items.reduce((sum,item)=>sum+BigInt(moneyCents(item.price)??-1)*BigInt(item.quantity),0n);
  const base=value.items.reduce((sum,item)=>sum+BigInt(moneyCents(item.originalPrice??item.price)??-1)*BigInt(item.quantity),0n);
  if(effective!==BigInt(moneyCents(value.total)??-1)||base!==BigInt(value.discountBudget.originalSubtotalCents)
    ||base-effective!==BigInt(value.discountBudget.promotionDiscountCents)||(moneyCents(value.currentDiscount)??Infinity)>Number(effective)
    ||value.items.some(item=>item.originalPrice!==undefined&&item.originalPrice<item.price
      ||item.crossSellIntent&&(item.quantity>item.crossSellIntent.acceptedQuantity||item.crossSellIntent.maximumUnitPriceCents!==moneyCents(item.price)
        ||item.crossSellIntent.originalUnitPriceCents!==moneyCents(item.originalPrice??item.price)))
    // P also includes canonical preserved historical savings. Its provenance,
    // quantity ceiling and company cap belong to the actual NEW/FIRST SEND
    // reader, not to an originalPrice hint or a numeric P=0 shortcut here.
    ||!value.items.some(item=>item.crossSellIntent)&&!(value.currentDiscount>0)
    ||new Set(value.items.map(item=>JSON.stringify([item.variantId,item.variant]))).size!==value.items.length
    ||(value.source==="storefront")!==(value.cart_ref!==undefined))ctx.addIssue({code:"custom",message:"normal_payment_projection_inconsistent"});
});
export const normalCheckoutFrozenProjectionSchema=z.strictObject({globalUserId:ref,cart,
  shipping:z.strictObject({customerPrice:money,carrier:z.string().min(1).max(300),method:z.string().min(1).max(300),deliveryDays:z.number().int().positive(),
    destinationZip:z.string().regex(/^\d{8}$/),region:z.string().length(2)}).optional(),
  customer:z.strictObject({fullName:z.string().trim().min(1).max(200),email:z.email().max(254),cpf:z.string().regex(/^\d{11}$/),phone:z.string().regex(/^\d{10,15}$/),
    email_verified:z.literal(true),address_verified:z.boolean().optional(),address:checkoutExplicitAddressSchema.optional()}),
}).superRefine((value,ctx)=>{
  if(requiresPhysicalDelivery(value.cart)){
    if(!value.shipping||!value.customer.address||value.customer.address_verified!==true
      ||value.shipping.destinationZip!==value.customer.address.zip||value.shipping.region!==value.customer.address.state)
      ctx.addIssue({code:"custom",message:"normal_payment_physical_delivery_required"});
  }else if(value.shipping!==undefined)ctx.addIssue({code:"custom",message:"normal_payment_virtual_delivery_forbidden"});
});
const breakdown=z.strictObject({version:z.literal(1),currency:z.literal("BRL"),cartFingerprint:hash,confirmedCartFingerprint:hash.optional(),
  itemsSubtotalCents:cents,discountCents:cents,shippingCents:cents,platformFeeCents:cents,totalCents:cents.positive()});
export const normalCheckoutPaymentAuthoritySchema=z.strictObject({version:z.literal(1),origin:z.literal("normal_checkout_cross_sell"),
  paymentId:ref,merchantId:ref,checkoutSessionId:ref,buyerId:ref,checkoutVersion:z.number().int().min(1).max(2_147_483_647),
  strategyContextVersion:z.number().int().min(0).max(2_147_483_647),acceptanceEventIds:z.array(ref).min(1).max(200).refine(ids=>new Set(ids).size===ids.length),
  contextHash:hash,basisHash:hash,method:z.enum(["pix","card","boleto","crypto"]),currency:z.literal("BRL"),amountCents:cents.positive(),
  admittedAt:z.iso.datetime({offset:true}),amountBreakdown:breakdown,frozenProjection:normalCheckoutFrozenProjectionSchema,
  discountOwner:normalCheckoutDiscountOwnerSchema.optional(),
}).superRefine((value,ctx)=>{
  const projection=value.frozenProjection,amounts=value.amountBreakdown;
  if(value.buyerId!==projection.globalUserId||paymentCartFingerprint(projection)!==amounts.cartFingerprint
    ||moneyCents(projection.cart.total)!==amounts.itemsSubtotalCents||moneyCents(projection.cart.currentDiscount)!==amounts.discountCents
    ||moneyCents(projection.shipping?.customerPrice??0)!==amounts.shippingCents||amounts.totalCents!==value.amountCents
    ||BigInt(amounts.itemsSubtotalCents)-BigInt(amounts.discountCents)+BigInt(amounts.shippingCents)+BigInt(amounts.platformFeeCents)!==BigInt(value.amountCents)
    ||value.discountOwner&&(value.discountOwner.merchantId!==value.merchantId||value.discountOwner.checkoutSessionId!==value.checkoutSessionId
      ||value.discountOwner.buyerId!==value.buyerId||value.discountOwner.discountCents!==amounts.discountCents)
    ||!value.discountOwner&&amounts.discountCents>0&&projection.cart.source!=="storefront")
    ctx.addIssue({code:"custom",message:"normal_payment_authority_inconsistent"});
});
export type NormalCheckoutPaymentAuthority=z.infer<typeof normalCheckoutPaymentAuthoritySchema>;
export function parseNormalCheckoutPaymentAuthority(raw:unknown):NormalCheckoutPaymentAuthority{
  try{return normalCheckoutPaymentAuthoritySchema.parse(raw);}catch{throw new Error("payment_normal_cross_sell_authority_conflict");}
}
