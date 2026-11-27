import { z } from "zod";
import { moneyCents } from "@zyon/rules-engine";
import { paymentCartFingerprint } from "../../checkout/domain/services/payment-cart-fingerprint.js";
import { checkoutExplicitAddressSchema } from "../../checkout/domain/services/checkout-explicit-address.schema.js";
import { requiresPhysicalDelivery } from "../../checkout/domain/services/cart-fulfillment.js";
import { crossSellAcceptedLineIntentSchema } from "../../cross-sell/domain/contracts/cross-sell-storefront-quote.schemas.js";
import { commercialNoticesSchema } from "../../storefront/domain/contracts/commercial-notice.schemas.js";
import { normalCheckoutCouponDiscountOwnerSchema } from "../../coupons/domain/contracts/normal-checkout-coupon-owner.schema.js";
import { normalCheckoutPolicyDiscountOwnerSchema,normalCheckoutAcceptedOfferDiscountOwnerSchema } from "../../checkout/domain/contracts/normal-commercial-benefit-proof.schemas.js";
import { normalCheckoutCashbackCombinationOwnerSchema } from "../../checkout/domain/contracts/normal-checkout-cashback-owner.schemas.js";

const legacyDiscountOwnerSchema=z.discriminatedUnion("kind",[
  normalCheckoutCouponDiscountOwnerSchema,normalCheckoutPolicyDiscountOwnerSchema,normalCheckoutAcceptedOfferDiscountOwnerSchema]);
export const normalCheckoutDiscountOwnerSchema=z.union([legacyDiscountOwnerSchema,normalCheckoutCashbackCombinationOwnerSchema]);
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
const legacyFrozenProjectionSchema=z.strictObject({globalUserId:ref,cart,
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
const cashbackCart = cart.safeExtend({ commercialBenefitsVersion: cents.positive().optional(), cashbackCents: cents.optional() });
const cashbackFrozenProjectionSchema = legacyFrozenProjectionSchema.safeExtend({ cart: cashbackCart });
export const normalCheckoutFrozenProjectionSchema = z.union([legacyFrozenProjectionSchema, cashbackFrozenProjectionSchema]);
const breakdown=z.strictObject({version:z.literal(1),currency:z.literal("BRL"),cartFingerprint:hash,confirmedCartFingerprint:hash.optional(),
  itemsSubtotalCents:cents,discountCents:cents,shippingCents:cents,platformFeeCents:cents,totalCents:cents.positive()});
const legacyAuthority = z.strictObject({version:z.literal(1),origin:z.literal("normal_checkout_cross_sell"),
  paymentId:ref,merchantId:ref,checkoutSessionId:ref,buyerId:ref,checkoutVersion:z.number().int().min(1).max(2_147_483_647),
  strategyContextVersion:z.number().int().min(0).max(2_147_483_647),acceptanceEventIds:z.array(ref).min(1).max(200).refine(ids=>new Set(ids).size===ids.length),
  contextHash:hash,basisHash:hash,method:z.enum(["pix","card","boleto","crypto"]),currency:z.literal("BRL"),amountCents:cents.positive(),
  admittedAt:z.iso.datetime({offset:true}),amountBreakdown:breakdown,frozenProjection:legacyFrozenProjectionSchema,
  discountOwner:legacyDiscountOwnerSchema.optional(),
});
const cashbackBreakdown = breakdown.extend({ cashbackCents: cents.optional(), cashbackReservationId: ref.optional(), cashbackEarningQuoteId: ref.optional() });
const cashbackAuthority = legacyAuthority.extend({ version: z.literal(2), amountBreakdown: cashbackBreakdown,
  frozenProjection: cashbackFrozenProjectionSchema, discountOwner: normalCheckoutDiscountOwnerSchema.optional() });
export const normalCheckoutPaymentAuthoritySchema = z.union([legacyAuthority, cashbackAuthority]).superRefine((value,ctx)=>{
  const projection=value.frozenProjection,amounts=value.amountBreakdown;
  const cashbackCents=value.version===2?value.amountBreakdown.cashbackCents??0:0;
  if(value.buyerId!==projection.globalUserId||paymentCartFingerprint(projection)!==amounts.cartFingerprint
    ||moneyCents(projection.cart.total)!==amounts.itemsSubtotalCents||moneyCents(projection.cart.currentDiscount)!==amounts.discountCents
    ||moneyCents(projection.shipping?.customerPrice??0)!==amounts.shippingCents||amounts.totalCents!==value.amountCents
    ||BigInt(amounts.itemsSubtotalCents)-BigInt(amounts.discountCents)-BigInt(cashbackCents)+BigInt(amounts.shippingCents)+BigInt(amounts.platformFeeCents)!==BigInt(value.amountCents)
    ||value.version===2&&cashbackCents>0&&!value.amountBreakdown.cashbackReservationId
    ||value.version===2&&value.frozenProjection.cart.cashbackCents!==undefined&&value.frozenProjection.cart.cashbackCents!==cashbackCents
    ||value.discountOwner&&(value.discountOwner.merchantId!==value.merchantId||value.discountOwner.checkoutSessionId!==value.checkoutSessionId
      ||value.discountOwner.buyerId!==value.buyerId||value.discountOwner.discountCents!==amounts.discountCents)
    ||!value.discountOwner&&amounts.discountCents>0&&projection.cart.source!=="storefront")
    ctx.addIssue({code:"custom",message:"normal_payment_authority_inconsistent"});
  if(value.discountOwner?.kind==="cashback_combination"&&(value.version!==2
    ||value.version===2&&value.frozenProjection.cart.commercialBenefitsVersion!==value.discountOwner.commercialBenefitsVersion
    ||value.discountOwner.coupon?.kind==="storefront_coupon"&&value.discountOwner.coupon.cartId!==projection.cart.cart_ref))
    ctx.addIssue({code:"custom",message:"normal_payment_authority_inconsistent"});
});
export type NormalCheckoutPaymentAuthority=z.infer<typeof normalCheckoutPaymentAuthoritySchema>;
export function parseNormalCheckoutPaymentAuthority(raw:unknown):NormalCheckoutPaymentAuthority{
  try{return normalCheckoutPaymentAuthoritySchema.parse(raw);}catch{throw new Error("payment_normal_cross_sell_authority_conflict");}
}
