import { createHash } from "node:crypto";
import { normalCheckoutCrossSellLegacyEventFields } from "../../domain/events/normal-checkout-cross-sell-event.js";
import { ConflictException, HttpException } from "@nestjs/common";
import { assertCheckoutBuyerIdentityTransition, assertCheckoutBuyerIdentityChatClaim } from "../../../../shared/persistence/checkout-buyer-identity-transition.js";
import type { ChatExchangeClaim } from "../../../checkout/domain/ports/checkout-session.repository.port.js";
import { isDeepStrictEqual } from "node:util";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { moneyCents } from "@zyon/rules-engine";
import { lockCheckoutSessionAnchor } from "../../../../shared/persistence/checkout-session-lock.js";
import { selectBestProductPromotion } from "../../../catalog/domain/services/best-product-promotion.service.js";
import { validateFoodMetadata, foodSelectionLimits } from "../../../catalog/domain/services/food-options-validation.js";
import { extractOptionGroups, resolveSelectedOptions } from "../../../storefront/domain/food-options.js";
import { storefrontOptionItemIdsSchema, storefrontSelectedOptionsSchema, storefrontOptionLineIdentity } from "../../../storefront/domain/contracts/storefront-claimed-cart-effect.schemas.js";
import { crossSellAcceptedLineIntentSchema } from "../../domain/contracts/cross-sell-storefront-quote.schemas.js";
import { crossSellStorefrontCartBasisSchema } from "../../domain/contracts/cross-sell-storefront-quote.schemas.js";
import { lockStorefrontCart } from "../../../../shared/persistence/storefront-cart-lock.js";
import { readStorefrontCheckoutBindingOwners } from "../../../../shared/persistence/storefront-coupon/cart-owner-fence.js";
import { readNormalCrossSellCouponAuthority, assertNormalCrossSellCouponProjection } from "../../../../shared/persistence/storefront-coupon/admission.js";
import { readStoredCheckoutCouponBinding } from "../../../checkout/domain/services/checkout-coupon-storage.js";
import { toCheckoutSession } from "../../../checkout/domain/services/checkout-session-projection.js";
import { normalCheckoutCrossSellScopeSchema, normalCheckoutCrossSellQuoteSchema, normalCheckoutCrossSellAcknowledgementSchema,
  type NormalCheckoutCrossSellScope, type NormalCheckoutCrossSellQuoteRequest } from "../../domain/contracts/normal-checkout-cross-sell-command.schemas.js";
import { normalCheckoutCrossSellBatchPricingInputSchema } from "../../domain/contracts/normal-checkout-cross-sell-pricing.schemas.js";
import { prepareNormalCheckoutCrossSellBatchPricing } from "../../domain/services/normal-checkout-cross-sell-pricing.js";
import { assertNormalCrossSellOwnPaymentForFirstSend, readPaymentNormalCrossSellAuthority } from "../../../payment/domain/payment-normal-cross-sell-authority.js";
import { readNormalCheckoutCouponOwner } from "../../../../shared/persistence/normal-checkout-coupon-owner.js";
import { readNormalCheckoutCommercialBenefitOwner } from "../../../../shared/persistence/normal-checkout-commercial-benefits.js";
import { normalCheckoutCatalogProductTypeSchema, readNormalCheckoutProductFulfillment } from "../../domain/services/normal-checkout-product-fulfillment.js";
import type { NormalCheckoutDiscountOwner } from "../../../payment/domain/normal-checkout-payment-authority.schemas.js";

const id = normalCheckoutCrossSellScopeSchema.shape.merchantId;
const cents = z.number().int().min(0).max(2_147_483_647);
const decimal = z.custom<Prisma.Decimal>(value => Prisma.Decimal.isDecimal(value));
const itemSchema = z.object({ sku: id, name: z.string(), variantId: id.optional(), product_id: id.optional(),
  productType: normalCheckoutCatalogProductTypeSchema.optional(), quantity: z.number().int().min(1).max(99),
  price: z.number().finite().nonnegative(), originalPrice: z.number().finite().nonnegative().optional(),
  variant: z.string().optional(), selected_options: z.array(z.unknown()).max(250).optional(),
  crossSellIntent: crossSellAcceptedLineIntentSchema.optional() }).passthrough();
const cartSchema = z.object({ currency: z.literal("BRL"), items: z.array(itemSchema).min(1).max(200),
  total: z.number().finite().nonnegative(), source: z.enum(["checkout","storefront"]).optional(), currentDiscount: z.number().finite().nonnegative().optional(),
  couponCode: id.nullable().optional(), freeShipping: z.literal(false).optional(),
  discountBudget: z.strictObject({version:z.literal(1),originalSubtotalCents:cents,promotionDiscountCents:cents}).optional(),
}).passthrough();
export const normalCrossSellSuggestionSchema = z.object({ id, merchantId:id, sessionId:id, promoId:id, rankedItems:z.array(id).min(1).max(200),
  status:z.enum(["pending","accepted"]), resolvedAt:z.date().nullable(), computedDiscount:decimal });
const suggestionSchema=normalCrossSellSuggestionSchema;
const promotionSchema = z.object({id,merchantId:id,updatedAt:z.date(),status:z.enum(["active","archived"]),
  startsAt:z.date(),endsAt:z.date().nullable(),recommendedSkus:z.array(id).min(1).max(200),discountPercent:decimal,maxDiscountPercent:decimal,
  trigger:z.strictObject({sku_in_cart:z.array(id).min(1).max(200).optional(),category_in_cart:z.array(id).min(1).max(200).optional(),
    cart_total_above:z.number().finite().nonnegative().optional()})});
const catalogSelect = {id:true,sku:true,isActive:true,price:{select:{variantId:true,basePriceInCents:true,currency:true}},
  weightGrams:true,heightCm:true,widthCm:true,lengthCm:true,media:{select:{url:true},orderBy:{order:"asc"},take:1},
  product:{select:{id:true,merchantId:true,name:true,type:true,isActive:true,deletedAt:true,metadata:true,categoryId:true,updatedAt:true}},
  stock:{select:{quantity:true,reserved:true}}} as const satisfies Prisma.ProductVariantSelect;
const rowSchema = z.object({id,sku:id,isActive:z.literal(true),price:z.object({variantId:id,basePriceInCents:cents,currency:z.literal("BRL")}),
  weightGrams:cents.nullable().optional(),heightCm:z.number().finite().nonnegative().nullable().optional(),
  widthCm:z.number().finite().nonnegative().nullable().optional(),lengthCm:z.number().finite().nonnegative().nullable().optional(),
  media:z.array(z.object({url:z.string().min(1).max(2048)})).max(1).optional(),
  product:z.object({id,merchantId:id,name:z.string().min(1).max(1000),type:normalCheckoutCatalogProductTypeSchema,isActive:z.literal(true),
    deletedAt:z.null(),metadata:z.unknown().refine(value=>value!==undefined),categoryId:id.nullable(),updatedAt:z.date()}),
  stock:z.array(z.object({quantity:cents,reserved:cents})).max(200)});
const productPromoSelect={id:true,merchantId:true,productId:true,variantId:true,categoryId:true,couponId:true,
  discountType:true,discountValue:true,promoPriceInCents:true,isActive:true,startsAt:true,endsAt:true} as const;
const productPromoSchema=z.object({id,merchantId:id,productId:id.nullable(),variantId:id.nullable(),categoryId:id.nullable(),couponId:id.nullable(),
  discountType:z.string().nullable(),discountValue:z.number().finite().nullable(),promoPriceInCents:cents.nullable(),isActive:z.boolean(),startsAt:z.date(),endsAt:z.date()});
export const normalCrossSellCartMutationSchema=z.strictObject({expectedVersion:z.number().int().min(0).max(2_147_483_646),
  items:z.array(z.strictObject({sku:id,variant:z.string().max(100_000).optional(),quantity:z.number().int().min(0).max(99)})).min(1).max(200)
    .refine(items=>new Set(items.map(item=>JSON.stringify([item.sku,item.variant??null]))).size===items.length)});
export const normalCrossSellEvidenceSchema=z.strictObject({protocol:z.literal("normal_checkout_cross_sell_v1"),buyerId:id,
  requestHash:z.string().regex(/^[a-f0-9]{64}$/),quote:normalCheckoutCrossSellQuoteSchema,ack:normalCheckoutCrossSellAcknowledgementSchema,
  session_id:id,suggestion_id:id,promo_id:id,accepted_skus:z.array(id).min(1).max(200),computed_discount:z.number().finite().min(0).max(100)});

export class NormalCheckoutCrossSellReviewError extends ConflictException {
  readonly code="cross_sell_quote_review_required";
  constructor(readonly reason:string="source_changed"){super("cross_sell_quote_review_required");}
}
export const requireNormalCrossSellReview=(reason?:string):never=>{throw new NormalCheckoutCrossSellReviewError(reason);};
export const normalCrossSellHash=(value:unknown):string=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const normalCrossSellEventId=(scope:NormalCheckoutCrossSellScope,suggestionId:string):string=>
  `normal_cross_sell_${normalCrossSellHash([scope.merchantId,scope.sessionId,suggestionId])}`;
export const normalCrossSellRequiredCents=(value:unknown)=>{const result=moneyCents(value);return result===null?requireNormalCrossSellReview():cents.parse(result);};
export function normalCrossSellContextHash(stored:{id:string;merchantId:string;sessionId:string;globalUserId:string;version:number;strategyContextVersion:number;cart:unknown;customer:unknown;shipping:unknown;shippingOptions:unknown;paymentMethod:string|null}){
  // A public deterministic digest must never become an offline OTP oracle.
  // Version/CAS still invalidate every persisted challenge replacement. Bind
  // only explicit identity/commercial fields, not arbitrary customer storage.
  const pick=(raw:unknown,keys:readonly string[])=>{
    if(raw===null||raw===undefined)return raw;
    if(typeof raw!=="object"||Array.isArray(raw))return requireNormalCrossSellReview("source_invalid");
    return Object.fromEntries(keys.map(key=>[key,Object.getOwnPropertyDescriptor(raw,key)?.value as unknown]));
  };
  const customer=pick(stored.customer,["fullName","cpf","email","phone","email_verified","phone_verified","address_verified",
    "recognized_buyer","isReturning","deliveryAddressLabel","externalCustomerId","asaasCustomerId"]);
  if(customer)customer.address=pick(Object.getOwnPropertyDescriptor(stored.customer as object,"address")?.value,
    ["zip","street","number","complement","neighborhood","city","state"]);
  return normalCrossSellHash([stored.id,stored.merchantId,stored.sessionId,stored.globalUserId,stored.version,stored.strategyContextVersion,
    stored.cart,customer,stored.shipping,stored.shippingOptions,stored.paymentMethod]);
}
export async function lockNormalCheckoutCrossSell(tx:Prisma.TransactionClient,scope:NormalCheckoutCrossSellScope){
  const merchants=z.array(z.object({id})).length(1).parse(await tx.$queryRaw`SELECT id FROM merchants WHERE id=${scope.merchantId} FOR UPDATE`);
  if(merchants[0]!.id!==scope.merchantId)return requireNormalCrossSellReview();
  await tx.$queryRaw`SELECT merchant_id FROM merchant_rules WHERE merchant_id=${scope.merchantId} FOR SHARE`;
  await tx.$queryRaw`SELECT merchant_id FROM checkout_settings WHERE merchant_id=${scope.merchantId} FOR SHARE`;
  await lockCheckoutSessionAnchor(tx,scope.merchantId,scope.sessionId);
  await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id=${scope.merchantId} AND session_id=${scope.sessionId} FOR UPDATE`;
}
/** Actual accepted suggestion + technical event + outbox are all required. JSON
 * intent alone is not provenance. The immutable evidence also serves lost ACK. */
export async function readNormalCrossSellEvidence(tx:Prisma.TransactionClient,scope:NormalCheckoutCrossSellScope,
  suggestion:z.infer<typeof suggestionSchema>,buyerId:string){
  const eventId=normalCrossSellEventId(scope,suggestion.id);
  await tx.$queryRaw`SELECT event_id FROM outbox_messages WHERE merchant_id=${scope.merchantId} AND event_id=${eventId} FOR SHARE`;
  const outbox=z.object({eventId:id,eventType:z.literal("cross-sell.offer.accepted"),schemaVersion:z.literal(1),merchantId:id,
    occurredAt:z.date(),causationId:id,producer:z.literal("cross-sell"),payload:normalCrossSellEvidenceSchema})
    .parse(await tx.outboxMessage.findFirst({where:{merchantId:scope.merchantId,eventId}}));
  const event=z.object({merchantId:id,sessionId:id,eventName:z.literal("cross_sell_accepted"),occurredAt:z.date(),metadata:z.unknown()})
    .parse(await tx.checkoutEvent.findFirst({where:{...scope,eventName:"cross_sell_accepted",metadata:{path:["acceptance_event_id"],equals:eventId}}}));
  const evidence=outbox.payload,{quote,ack}=evidence;
  const compatibility=normalCheckoutCrossSellLegacyEventFields(quote);
  if(!isDeepStrictEqual({session_id:evidence.session_id,suggestion_id:evidence.suggestion_id,promo_id:evidence.promo_id,
    accepted_skus:evidence.accepted_skus,computed_discount:evidence.computed_discount},compatibility))return requireNormalCrossSellReview("accepted_evidence_invalid");
  if(suggestion.status!=="accepted"||suggestion.merchantId!==scope.merchantId||suggestion.sessionId!==scope.sessionId
    ||outbox.eventId!==eventId||outbox.merchantId!==scope.merchantId||outbox.causationId!==suggestion.id
    ||quote.merchantId!==scope.merchantId||quote.sessionId!==scope.sessionId||quote.suggestionId!==suggestion.id
    ||ack.merchantId!==scope.merchantId||ack.sessionId!==scope.sessionId||ack.suggestionId!==suggestion.id
    ||ack.persistenceVersion!==quote.sessionVersion+1||ack.quoteHash!==normalCrossSellHash(quote)
    ||quote.pricing.targets.some(target=>target.promotionId!==suggestion.promoId||!suggestion.rankedItems.includes(target.sku))
    ||suggestion.resolvedAt?.getTime()!==outbox.occurredAt.getTime()||event.occurredAt.getTime()!==outbox.occurredAt.getTime()
    ||event.merchantId!==scope.merchantId||event.sessionId!==scope.sessionId
    ||!isDeepStrictEqual(event.metadata,{suggestion_id:suggestion.id,acceptance_event_id:eventId,checkout_version:ack.persistenceVersion}))return requireNormalCrossSellReview("accepted_evidence_invalid");
  try{await assertCheckoutBuyerIdentityTransition(tx,scope,eventId,evidence.buyerId,buyerId,ack.persistenceVersion);}
  catch(error){if(error instanceof Error&&error.message==="checkout_buyer_identity_review_required")return requireNormalCrossSellReview("buyer_transition_required");throw error;}
  return evidence;
}

/** Caller owns the merchant/config/session fence and transaction. This initial
 * standalone boundary deliberately refuses source/coupon/strategy ownership;
 * no cart_ref, parallel receipt, fabricated cart or price authority from body. */
export async function readNormalCheckoutCrossSellAuthority(tx:Prisma.TransactionClient,scope:NormalCheckoutCrossSellScope,
  request?:NormalCheckoutCrossSellQuoteRequest,options:{mutation?:z.infer<typeof normalCrossSellCartMutationSchema>;
    ownPayment?:{paymentId:string;version:number};ownChatClaim?:ChatExchangeClaim}={}){
  const stored=await tx.checkoutSession.findUnique({where:{merchantId_sessionId:scope}});
  if(!stored||stored.merchantId!==scope.merchantId||stored.sessionId!==scope.sessionId||!id.safeParse(stored.globalUserId).success
    ||!Number.isInteger(stored.version)||stored.version<0||stored.version>=2_147_483_647)return requireNormalCrossSellReview();
  const cart=cartSchema.parse(stored.cart);
  const originalCart=structuredClone(cart);
  const source=cart.source==="storefront"?await readNormalCrossSellSource(tx,scope,originalCart,stored.globalUserId,
    request||options.mutation?"mutation":"read"):undefined;
  const priorQuantities=new Map(cart.items.map(item=>[JSON.stringify([item.sku,item.variant??null]),item.quantity]));
  if(options.mutation){const mutation=normalCrossSellCartMutationSchema.parse(options.mutation);
    if(request||mutation.expectedVersion!==stored.version||!originalCart.items.some(item=>item.crossSellIntent))return requireNormalCrossSellReview("snapshot_changed");
    for(const change of mutation.items){const matches=cart.items.filter(item=>item.sku===change.sku&&(change.variant===undefined||item.variant===change.variant));
      if(matches.length!==1)return requireNormalCrossSellReview("line_identity_required");
      const item=matches[0]!;if(change.quantity===0)cart.items=cart.items.filter(line=>line!==item);else item.quantity=change.quantity;}
    const total=cart.items.reduce((sum,item)=>sum+BigInt(normalCrossSellRequiredCents(item.price))*BigInt(item.quantity),0n);
    if(total>2_147_483_647n)return requireNormalCrossSellReview("monetary_overflow");cart.total=Number(total)/100;
  }
  const sourceDiscount=source?.basis.discount??0;
  const existingDiscount=normalCrossSellRequiredCents(cart.currentDiscount??0);
  if(sourceDiscount>0&&existingDiscount!==sourceDiscount)
    return requireNormalCrossSellReview("existing_benefit_requires_review");
  if(Object.keys(cart).some(key=>key.startsWith("_")&&!(key==="_storefrontCouponBinding"&&source?.binding))||cart.cart_ref!==undefined&&!source||cart.commerceCartRef!==undefined
    ||cart.commercialNudge!==undefined&&!existingDiscount||Array.isArray(cart.appliedBenefits)&&cart.appliedBenefits.length>0&&!existingDiscount
    ||cart.items.some(item=>Object.keys(item).some(key=>key.startsWith("_"))||item.marketplace!==undefined||item.fulfillmentSchedule!==undefined))return requireNormalCrossSellReview("unsupported_owner");
  if(stored.shipping&&typeof stored.shipping==="object"){
    const selected=stored.shipping as Record<string,unknown>;
    if(selected.freeShipping===true||selected.discount!==undefined&&selected.discount!==0
      ||typeof selected.originalCustomerPrice==="number"&&selected.originalCustomerPrice!==selected.customerPrice)return requireNormalCrossSellReview("shipping_benefit_owner");
  }
  let ownAuthority:ReturnType<typeof readPaymentNormalCrossSellAuthority>;
  if(options.ownPayment){
    if(request||options.mutation)return requireNormalCrossSellReview("active_owner");
    const own=z.strictObject({paymentId:id,version:z.number().int().positive()}).parse(options.ownPayment);
    const actual=await tx.paymentIntent.findFirst({where:{...scope,id:own.paymentId}});
    assertNormalCrossSellOwnPaymentForFirstSend(actual,{...scope,paymentId:own.paymentId,version:own.version});
    if(!actual)return requireNormalCrossSellReview("active_owner");
    ownAuthority=readPaymentNormalCrossSellAuthority(actual);
    if(!ownAuthority)return requireNormalCrossSellReview("active_owner");
  }
  if(options.ownChatClaim)await assertCheckoutBuyerIdentityChatClaim(tx,scope,options.ownChatClaim,stored.conversationId);
  const standaloneCoupon=!sourceDiscount?await tx.couponRedemption.findFirst({where:{...scope,status:{not:"cancelled"}},select:{id:true}}):null;
  const acceptedOffer=await tx.acceptedOffer.findFirst({where:scope,select:{id:true}});
  if(await tx.paymentIntent.findFirst({where:{...scope,status:{notIn:["failed","cancelled"]},...(ownAuthority?{id:{not:ownAuthority.paymentId}}:{})},select:{id:true}})
    ||await tx.completedOrder.findFirst({where:scope,select:{id:true}})
    ||!options.ownChatClaim&&await tx.checkoutChatRequest.findFirst({where:{...scope,status:{in:["processing","unknown"]}},select:{id:true}})
    ||!existingDiscount&&(standaloneCoupon||acceptedOffer)
    ||await tx.strategyAssignment.findUnique({where:{merchantId_sessionId:scope},select:{id:true}})
    ||await tx.strategyIncentiveReservation.findFirst({where:{...scope,status:{in:["reserved","spent"]}},select:{id:true}}))return requireNormalCrossSellReview("active_owner");
  const rules=z.object({merchantId:id,maxDiscountPercent:decimal}).parse(await tx.merchantRule.findUnique({where:{merchantId:scope.merchantId},select:{merchantId:true,maxDiscountPercent:true}}));
  if(rules.merchantId!==scope.merchantId)return requireNormalCrossSellReview();
  if(request)await tx.$queryRaw`SELECT id FROM cross_sell_suggestions WHERE merchant_id=${scope.merchantId} AND session_id=${scope.sessionId} AND id=${request.suggestion_id} FOR UPDATE`;
  const suggestion=request?suggestionSchema.parse(await tx.crossSellSuggestion.findFirst({where:{id:request.suggestion_id,...scope}})):undefined;
  if(suggestion&&(suggestion.id!==request!.suggestion_id||suggestion.merchantId!==scope.merchantId||suggestion.sessionId!==scope.sessionId||suggestion.status!=="pending"))return requireNormalCrossSellReview();
  const accepted=z.array(suggestionSchema).max(200).parse(await tx.crossSellSuggestion.findMany({where:{...scope,status:"accepted"},orderBy:{id:"asc"},take:201}));
  const evidence:Array<Awaited<ReturnType<typeof readNormalCrossSellEvidence>>>=[];
  for(const source of accepted)evidence.push(await readNormalCrossSellEvidence(tx,scope,source,stored.globalUserId));
  const promoIds=[...new Set([...(suggestion?[suggestion.promoId]:[]),...cart.items.flatMap(item=>item.crossSellIntent?[item.crossSellIntent.promotionId]:[]),
    ...evidence.flatMap(value=>value.quote.pricing.targets.map(target=>target.promotionId))])].sort();
  await tx.$queryRaw`SELECT id FROM cross_sell_promotions WHERE merchant_id=${scope.merchantId} AND id=ANY(${promoIds}::text[]) ORDER BY id FOR SHARE`;
  const promotions=z.array(promotionSchema).max(200).parse(await tx.crossSellPromotion.findMany({where:{merchantId:scope.merchantId,id:{in:promoIds}},take:201}));
  const skus=[...new Set([...cart.items.map(item=>item.sku),...(request?.targets.map(target=>target.sku)??[])])].sort();
  const probes=z.array(z.object({id,sku:id})).max(400).parse(await tx.productVariant.findMany({where:{product:{merchantId:scope.merchantId},sku:{in:skus}},select:{id:true,sku:true},take:401}));
  const ids=probes.map(row=>row.id).sort();
  await tx.$queryRaw`SELECT p.id FROM products p WHERE p.merchant_id=${scope.merchantId} AND p.id IN (SELECT v.product_id FROM product_variants v WHERE v.id=ANY(${ids}::text[])) ORDER BY p.id FOR SHARE OF p`;
  await tx.$queryRaw`SELECT v.id FROM product_variants v JOIN products p ON p.id=v.product_id WHERE p.merchant_id=${scope.merchantId} AND v.id=ANY(${ids}::text[]) ORDER BY v.id FOR SHARE OF v`;
  await tx.$queryRaw`SELECT price.id FROM product_prices price JOIN product_variants v ON v.id=price.variant_id JOIN products p ON p.id=v.product_id WHERE p.merchant_id=${scope.merchantId} AND v.id=ANY(${ids}::text[]) ORDER BY price.id FOR SHARE OF price`;
  await tx.$queryRaw`SELECT stock.id FROM product_stock stock JOIN product_variants v ON v.id=stock.variant_id JOIN products p ON p.id=v.product_id WHERE p.merchant_id=${scope.merchantId} AND v.id=ANY(${ids}::text[]) ORDER BY stock.id FOR SHARE OF stock`;
  await tx.$queryRaw`SELECT promotion.id FROM product_promotions promotion WHERE promotion.merchant_id=${scope.merchantId} AND (promotion.variant_id=ANY(${ids}::text[]) OR promotion.product_id IN (SELECT v.product_id FROM product_variants v WHERE v.id=ANY(${ids}::text[])) OR promotion.category_id IN (SELECT p.category_id FROM products p JOIN product_variants v ON v.product_id=p.id WHERE p.merchant_id=${scope.merchantId} AND v.id=ANY(${ids}::text[]))) ORDER BY promotion.id FOR SHARE OF promotion`;
  const rows=z.array(rowSchema).max(400).parse(await tx.productVariant.findMany({where:{product:{merchantId:scope.merchantId},sku:{in:skus}},select:catalogSelect,take:401}));
  if(rows.length!==ids.length||new Set(ids).size!==ids.length||rows.some(row=>!ids.includes(row.id)))return requireNormalCrossSellReview();
  const products=z.array(productPromoSchema).parse(await tx.productPromotion.findMany({where:{merchantId:scope.merchantId,OR:[{variantId:{in:ids}},{productId:{in:rows.map(row=>row.product.id)}},{categoryId:{in:rows.flatMap(row=>row.product.categoryId?[row.product.categoryId]:[])}}]},select:productPromoSelect}));
  const [clock]=z.array(z.object({now:z.date()})).length(1).parse(await tx.$queryRaw`SELECT clock_timestamp() AS now`);
  if(source&&source.row.expiresAt.getTime()<=clock!.now.getTime())return requireNormalCrossSellReview("source_expired");
  const coupon=sourceDiscount?await readNormalCrossSellCouponAuthority(tx,scope):undefined;
  if(coupon){
    if(coupon.candidate.discountCents!==sourceDiscount||coupon.candidate.cartId!==source!.row.sessionId||coupon.candidate.buyerId!==stored.globalUserId
      ||cart.couponCode!==undefined&&cart.couponCode!==coupon.candidate.couponCode)return requireNormalCrossSellReview("coupon_owner_required");
    const nudge=cart.commercialNudge;
    if(nudge!==undefined&&(!nudge||typeof nudge!=="object"||!("kind"in nudge)||nudge.kind!=="coupon"
      ||!("couponCode"in nudge)||nudge.couponCode!==coupon.candidate.couponCode))return requireNormalCrossSellReview("coupon_owner_required");
    if(cart.appliedBenefits!==undefined&&(!Array.isArray(cart.appliedBenefits)||cart.appliedBenefits.length!==1
      ||cart.appliedBenefits.some(value=>!value||typeof value!=="object"||value.kind!=="discount"||normalCrossSellRequiredCents(value.amount)!==sourceDiscount)))return requireNormalCrossSellReview("coupon_owner_required");
    if(source!.binding?.state==="active"){
      const binding=source!.binding,candidate=coupon.candidate;
      const keys=["merchantId","cartId","checkoutSessionId","buyerId","reservationBuyerId","redemptionId","couponId","discountCents","basisHash"]as const;
      if(keys.some(key=>binding[key]!==candidate[key]))return requireNormalCrossSellReview("coupon_owner_required");
    }
  }
  const stockRequests=new Map<string,number>();
  const fulfillments=new Map<string,ReturnType<typeof readNormalCheckoutProductFulfillment>>();
  const resolve=(sku:string,variantId:string|undefined,productId:string|undefined,quantity:number,optionIds:string[])=>{
    const matches=rows.filter(row=>row.sku===sku);if(matches.length!==1)return requireNormalCrossSellReview("catalog_ambiguous");
    const row=matches[0]!;
    if(row.product.merchantId!==scope.merchantId||row.price.variantId!==row.id||variantId!==undefined&&variantId!==row.id||productId!==undefined&&productId!==row.product.id)return requireNormalCrossSellReview();
    const fulfillment=readNormalCheckoutProductFulfillment({type:row.product.type,metadata:row.product.metadata},clock!.now);
    fulfillments.set(row.id,fulfillment);
    if(validateFoodMetadata(row.product.metadata))return requireNormalCrossSellReview("options_invalid");
    const selected=resolveSelectedOptions(extractOptionGroups(row.product.metadata),optionIds);
    const canonical=storefrontSelectedOptionsSchema.parse(selected.selected).sort((a,b)=>a.itemId<b.itemId?-1:a.itemId>b.itemId?1:0);
    const groups=(row.product.metadata as {optionGroups?:Array<{id:string;required?:boolean;selectionType?:string;minSelections?:number;maxSelections?:number;items:unknown[]}>}|null)?.optionGroups??[];
    for(const group of groups){const count=canonical.filter(option=>option.groupId===group.id).length,limits=foodSelectionLimits(group);
      if(count<limits.min||count>limits.max)return requireNormalCrossSellReview("options_required");}
    const base=cents.parse(row.price.basePriceInCents+selected.priceModifierInCents);
    if(fulfillment.requiresStock)stockRequests.set(row.id,(stockRequests.get(row.id)??0)+quantity);
    const best=selectBestProductPromotion({merchantId:scope.merchantId,productId:row.product.id,variantId:row.id,categoryId:row.product.categoryId??undefined,
      baseUnitPriceCents:base,promotions:products,now:clock!.now});
    return {variantId:row.id,productId:row.product.id,sku:row.sku,quantity,baseUnitPriceCents:base,
      ...(row.product.categoryId?{categoryId:row.product.categoryId}:{}),...(canonical.length?{selectedOptions:canonical}:{}),
      ...(best.promotionId?{productCandidate:{promotionId:best.promotionId,unitPriceCents:best.unitPriceCents,unitDiscountCents:best.unitDiscountCents}}:{})};
  };
  const promotionFor=(promoId:string)=>{const matches=promotions.filter(row=>row.id===promoId&&row.merchantId===scope.merchantId);
    if(matches.length!==1)return requireNormalCrossSellReview();const row=matches[0]!;
    return {id:row.id,merchantId:row.merchantId,updatedAt:row.updatedAt.toISOString(),status:row.status,startsAt:row.startsAt.toISOString(),endsAt:row.endsAt?.toISOString()??null,
      recommendedSkus:row.recommendedSkus,discountPercent:row.discountPercent.toString(),maxDiscountPercent:row.maxDiscountPercent.toString(),trigger:{
        ...(row.trigger.sku_in_cart?{skuInCart:row.trigger.sku_in_cart}:{}),...(row.trigger.category_in_cart?{categoryInCart:row.trigger.category_in_cart}:{}),
        ...(row.trigger.cart_total_above===undefined?{}:{cartTotalAboveCents:normalCrossSellRequiredCents(row.trigger.cart_total_above)})}};};
  const lines=cart.items.map(item=>{
    let optionIds:string[]=[];
    if(item.variant!==undefined){const identity=z.tuple([id,storefrontOptionItemIdsSchema]).parse(JSON.parse(item.variant));if(identity[0]!==item.variantId)return requireNormalCrossSellReview();optionIds=identity[1];}
    else if(item.selected_options?.length)return requireNormalCrossSellReview();
    const canonical=resolve(item.sku,item.variantId,item.product_id,item.quantity,optionIds);
    const fulfillment=fulfillments.get(canonical.variantId)!;
    if(item.productType!==undefined&&item.productType!==fulfillment.productType)return requireNormalCrossSellReview("catalog_type_changed");
    if(item.fulfillmentStrategy!==undefined&&item.fulfillmentStrategy!==fulfillment.fulfillmentStrategy)return requireNormalCrossSellReview("fulfillment_changed");
    if(!isDeepStrictEqual(item.selected_options??[],(canonical.selectedOptions??[]).map(option=>({group_name:option.groupName,item_name:option.itemName,price_modifier:option.priceModifierInCents/100}))))return requireNormalCrossSellReview();
    const saved=normalCrossSellRequiredCents(item.price);
    const sourceLine=source?.basis.items.find(line=>storefrontOptionLineIdentity(line)===storefrontOptionLineIdentity(canonical));
    if(source&&!sourceLine)return requireNormalCrossSellReview("source_changed");
    if(item.crossSellIntent){const intent=item.crossSellIntent;
      const matches=evidence.filter(value=>value.quote.pricing.targets.some(target=>storefrontOptionLineIdentity(target)===storefrontOptionLineIdentity(canonical)
        &&target.sku===canonical.sku&&target.productId===canonical.productId&&isDeepStrictEqual(normalCrossSellTargetIntent(target),intent)));
      // Strip target-only keys before strict V1 parsing; event shape is otherwise
      // validated separately and must match the entire persisted intent.
      if(matches.length>1||matches.length===0&&!sourceLine||saved!==intent.maximumUnitPriceCents||normalCrossSellRequiredCents(item.originalPrice)!==canonical.baseUnitPriceCents
        ||sourceLine&&sourceLine.unitPriceCents!==canonical.baseUnitPriceCents)return requireNormalCrossSellReview("accepted_evidence_invalid");
      return {...canonical,kind:"accepted_intent" as const,intent,promotion:promotionFor(intent.promotionId),
        excludedTriggerVariantIds:matches.length?[...new Set(matches[0]!.quote.pricing.targets.map(target=>target.variantId))]:[]};
    }
    const authorizedSaved=sourceLine?.unitPriceCents??saved;
    if(authorizedSaved>canonical.baseUnitPriceCents)return requireNormalCrossSellReview("base_changed");
    if(sourceLine&&(authorizedSaved<canonical.baseUnitPriceCents?saved!==authorizedSaved:
      normalCrossSellRequiredCents(item.originalPrice??item.price)!==canonical.baseUnitPriceCents))return requireNormalCrossSellReview("source_changed");
    if(authorizedSaved<canonical.baseUnitPriceCents){const{productCandidate:_candidate,...base}=canonical;return {...base,kind:"preserved_saved" as const,savedUnitPriceCents:authorizedSaved,
      existingQuantity:priorQuantities.get(JSON.stringify([item.sku,item.variant??null]))??requireNormalCrossSellReview()};}
    return {...canonical,kind:"canonical" as const};
  });
  if(cart.items.reduce((sum,item)=>sum+BigInt(normalCrossSellRequiredCents(item.price))*BigInt(item.quantity),0n)!==BigInt(normalCrossSellRequiredCents(cart.total)))return requireNormalCrossSellReview();
  const targets=(request?.targets??[]).map(target=>{
    if(!suggestion!.rankedItems.includes(target.sku))return requireNormalCrossSellReview();
    return {...resolve(target.sku,target.variant_id,undefined,target.quantity,target.selected_option_item_ids??[]),promotion:promotionFor(suggestion!.promoId)};
  });
  for(const[variantId,quantity]of stockRequests){const row=rows.find(row=>row.id===variantId)!;
    if(row.stock.reduce((sum,stock)=>sum+BigInt(stock.quantity)-BigInt(stock.reserved),0n)<BigInt(quantity))return requireNormalCrossSellReview("stock_unavailable");}
  const input=normalCheckoutCrossSellBatchPricingInputSchema.parse({merchantId:scope.merchantId,now:clock!.now.toISOString(),
    policy:{merchantId:rules.merchantId,maxDiscountPercent:rules.maxDiscountPercent.toNumber()},currentDiscountCents:existingDiscount,lines,targets,
    catalogVariants:rows.map(row=>({variantId:row.id,productId:row.product.id,sku:row.sku,merchantId:row.product.merchantId,isActive:row.isActive,
      productActive:row.product.isActive,productDeletedAt:null,currency:row.price.currency,baseUnitPriceCents:row.price.basePriceInCents}))});
  const pricing=prepareNormalCheckoutCrossSellBatchPricing(input);if(pricing.kind!=="quote_candidate")return requireNormalCrossSellReview(pricing.reason);
  const canonicalCart={...toCheckoutSession(stored).cart,total:pricing.merchandiseSubtotalCents/100,currentDiscount:existingDiscount/100,
    discountBudget:{version:1 as const,originalSubtotalCents:pricing.originalSubtotalCents,promotionDiscountCents:pricing.promotionDiscountCents},
    items:pricing.items.map(line=>{
      const existing=cart.items.find(item=>item.variantId===line.variantId&&(item.variant??JSON.stringify([item.variantId,[]]))
        ===JSON.stringify([line.variantId,(line.selectedOptions??[]).map(option=>option.itemId).sort()]));
      const {originalPrice:_original,selected_options:_savedOptions,...saved}=existing??{};
      Reflect.deleteProperty(saved,"category");
      const category=rows.find(row=>row.id===line.variantId)!.product.categoryId;
      const fulfillment=fulfillments.get(line.variantId)!;
      return {...saved,sku:line.sku,name:existing?.name??line.sku,variantId:line.variantId,product_id:line.productId,productType:fulfillment.productType,
        fulfillmentStrategy:fulfillment.fulfillmentStrategy,
        quantity:line.quantity,price:line.unitPriceCents/100,variant:JSON.stringify([line.variantId,(line.selectedOptions??[]).map(option=>option.itemId).sort()]),
        ...(category?{category}:{}),
        ...(line.unitPriceCents<line.baseUnitPriceCents?{originalPrice:line.baseUnitPriceCents/100}:{}),
        ...(line.selectedOptions?.length?{selected_options:line.selectedOptions.map(option=>({group_name:option.groupName,item_name:option.itemName,price_modifier:option.priceModifierInCents/100}))}:{})};
    })};
  let discountOwner:NormalCheckoutDiscountOwner|undefined;
  if(!sourceDiscount&&existingDiscount){
    try{
      if(canonicalCart.commercialNudge?.kind==="coupon"){
        if(source)return requireNormalCrossSellReview("coupon_owner_required");
        discountOwner=await readNormalCheckoutCouponOwner(tx,toCheckoutSession(stored),canonicalCart,clock!.now);
      }else discountOwner=await readNormalCheckoutCommercialBenefitOwner(tx,{stored,canonicalCart,now:clock!.now});
    }catch(error){
      const response=error instanceof HttpException?error.getResponse():undefined;
      if(error instanceof z.ZodError||error instanceof Error&&error.message==="normal_checkout_coupon_review_required"
        ||response&&typeof response==="object"&&"code"in response&&response.code==="cross_sell_quote_review_required")return requireNormalCrossSellReview("benefit_owner_required");throw error;
    }
    if(!discountOwner||standaloneCoupon&&discountOwner.kind!=="checkout_coupon"
      ||acceptedOffer&&(discountOwner.kind!=="accepted_offer"||discountOwner.acceptedOfferRowId!==acceptedOffer.id))return requireNormalCrossSellReview("benefit_owner_required");
  }
  if(sourceDiscount&&acceptedOffer)return requireNormalCrossSellReview("benefit_owner_required");
  if(coupon)assertNormalCrossSellCouponProjection(coupon,{...toCheckoutSession(stored).cart,total:pricing.merchandiseSubtotalCents/100,
    currentDiscount:sourceDiscount/100,items:pricing.items.map(line=>({sku:line.sku,name:line.sku,quantity:line.quantity,price:line.unitPriceCents/100}))},clock!.now);
  // Existing acceptance is a ceiling, not permission to silently change its
  // saved quotation when another catalog/promotion candidate moves. Until an
  // explicit reacceptance lifecycle exists, preserve its exact effective cents.
  for(const[index,item]of cart.items.entries())if(item.crossSellIntent){
    const identity=storefrontOptionLineIdentity(input.lines[index]!);
    const projected=pricing.items.find(line=>storefrontOptionLineIdentity(line)===identity);
    if(!projected||projected.unitPriceCents!==normalCrossSellRequiredCents(item.price))return requireNormalCrossSellReview("accepted_price_changed");
  }
  const byIdentity=(a:{variantId:string;selectedOptions?:Array<{itemId:string}>},b:{variantId:string;selectedOptions?:Array<{itemId:string}>})=>
    storefrontOptionLineIdentity(a)<storefrontOptionLineIdentity(b)?-1:storefrontOptionLineIdentity(a)>storefrontOptionLineIdentity(b)?1:0;
  const acceptanceEventIds=accepted.map(accepted=>normalCrossSellEventId(scope,accepted.id)).sort();
  const contextHash=normalCrossSellContextHash(stored),basisHash=normalCrossSellHash({...input,now:undefined,
    catalogFulfillment:rows.map(row=>({variantId:row.id,productId:row.product.id,productType:row.product.type,
      fulfillmentStrategy:fulfillments.get(row.id)!.fulfillmentStrategy,productUpdatedAt:row.product.updatedAt.toISOString()})).sort((a,b)=>a.variantId<b.variantId?-1:a.variantId>b.variantId?1:0),
    ...(discountOwner?{discountOwner}:{}),
    ...(source?{source:{id:source.row.id,merchantId:source.row.merchantId,cartRef:source.row.sessionId,updatedAt:source.row.updatedAt.toISOString(),
      expiresAt:source.row.expiresAt.toISOString(),basis:source.basis}}:{}),
    lines:[...input.lines].sort(byIdentity),targets:[...input.targets].sort(byIdentity),catalogVariants:[...input.catalogVariants].sort((a,b)=>a.variantId<b.variantId?-1:a.variantId>b.variantId?1:0)});
  if(ownAuthority&&(ownAuthority.checkoutVersion!==stored.version||ownAuthority.strategyContextVersion!==stored.strategyContextVersion
    ||ownAuthority.buyerId!==stored.globalUserId||ownAuthority.contextHash!==contextHash||ownAuthority.basisHash!==basisHash
    ||!isDeepStrictEqual(ownAuthority.acceptanceEventIds,[...acceptanceEventIds].sort())||!isDeepStrictEqual(ownAuthority.discountOwner,discountOwner)
    ||Date.parse(ownAuthority.admittedAt)>clock!.now.getTime()))return requireNormalCrossSellReview("payment_source_changed");
  return {stored,cart,originalCart,rows,input,pricing,suggestion,now:clock!.now,acceptanceEventIds,contextHash,basisHash,source,coupon,discountOwner};
}

/** Actual reference from the authenticated persisted checkout, never an inferred
 * checkoutId/cartId conversion or an upsert. Checkout fence must precede this. */
async function readNormalCrossSellSource(tx:Prisma.TransactionClient,scope:NormalCheckoutCrossSellScope,cart:z.infer<typeof cartSchema>,buyerId:string,purpose:"read"|"mutation"){
  const cartRef=id.parse(cart.cart_ref);
  await lockStorefrontCart(tx,scope.merchantId,cartRef);
  const owners=await readStorefrontCheckoutBindingOwners(tx,scope.merchantId,cartRef),binding=readStoredCheckoutCouponBinding(cart);
  if(owners.length){const owner=owners[0]!;
    if(purpose!=="read"||owners.length!==1||!binding||binding.state!=="active"||owner.merchantId!==scope.merchantId
      ||owner.sessionId!==scope.sessionId||owner.buyerId!==buyerId||owner.cartRef!==cartRef||!isDeepStrictEqual(owner.binding,binding))return requireNormalCrossSellReview("coupon_owner_required");
  }else if(binding&&binding.state!=="released")return requireNormalCrossSellReview("coupon_owner_required");
  const row=await tx.storefrontCart.findUnique({where:{merchantId_sessionId:{merchantId:scope.merchantId,sessionId:cartRef}}});
  if(!row||row.merchantId!==scope.merchantId||row.sessionId!==cartRef||!(row.expiresAt instanceof Date)||!(row.updatedAt instanceof Date))return requireNormalCrossSellReview("source_changed");
  // Keep the source basis refinements intact while separately validating the
  // canonical coupon reference; the base no-coupon schema cannot be safely
  // extended from null to string|null.
  const couponCode=id.nullable().parse(row.couponCode);
  const basis={...crossSellStorefrontCartBasisSchema.parse({items:row.items,total:row.total,discount:row.discount,couponCode:null,freeShipping:row.freeShipping}),couponCode};
  if((basis.discount>0)!==(basis.couponCode!==null)||basis.items.length!==cart.items.length)return requireNormalCrossSellReview("source_changed");
  for(const item of cart.items){
    const variantId=id.parse(item.variantId);let ids:string[]=[];
    if(item.variant!==undefined){const identity=z.tuple([id,storefrontOptionItemIdsSchema]).parse(JSON.parse(item.variant));if(identity[0]!==variantId)return requireNormalCrossSellReview();ids=identity[1];}
    else if(item.selected_options?.length)return requireNormalCrossSellReview();
    const matches=basis.items.filter(line=>storefrontOptionLineIdentity(line)===storefrontOptionLineIdentity({variantId,selectedOptionItemIds:ids}));
    if(matches.length!==1)return requireNormalCrossSellReview("source_changed");const line=matches[0]!;
    if(line.sku!==item.sku||line.productId!==item.product_id||line.quantity!==item.quantity||!isDeepStrictEqual(line.crossSellIntent,item.crossSellIntent)
      ||!isDeepStrictEqual((line.selectedOptions??[]).map(option=>({group_name:option.groupName,item_name:option.itemName,price_modifier:option.priceModifierInCents/100})),item.selected_options??[]))return requireNormalCrossSellReview("source_changed");
  }
  return {row,basis,binding};
}

export function normalCrossSellTargetIntent(target:{version:1;promotionId:string;promotionUpdatedAt:string;acceptedQuantity:number;
  originalUnitPriceCents:number;maximumUnitPriceCents:number;selectedOptionItemIds?:string[]}){
  return crossSellAcceptedLineIntentSchema.parse({version:target.version,promotionId:target.promotionId,promotionUpdatedAt:target.promotionUpdatedAt,
    acceptedQuantity:target.acceptedQuantity,originalUnitPriceCents:target.originalUnitPriceCents,maximumUnitPriceCents:target.maximumUnitPriceCents,
    ...(target.selectedOptionItemIds===undefined?{}:{selectedOptionItemIds:target.selectedOptionItemIds})});
}
