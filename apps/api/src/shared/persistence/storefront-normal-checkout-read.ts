import type { Prisma } from "@prisma/client";
import { z } from "zod";
import type { StorefrontCart } from "../../modules/storefront/domain/ports/storefront-cart.port.js";
import { storefrontOptionLineIdentity } from "../../modules/storefront/domain/contracts/storefront-claimed-cart-effect.schemas.js";
import { commercialNotice } from "../../modules/storefront/domain/services/commercial-notice.js";
import { NormalCheckoutProductFulfillmentError } from "../../modules/cross-sell/domain/services/normal-checkout-product-fulfillment.js";
import { FoodOptionValidationError } from "../../modules/storefront/domain/food-options.js";
import { StorefrontCouponEligibilityReviewRequired } from "./storefront-coupon/contracts.js";
import { lockNormalCheckoutCrossSell, readNormalCheckoutCrossSellAuthority, requireNormalCrossSellReview }
  from "../../modules/cross-sell/infrastructure/repositories/prisma-normal-checkout-cross-sell.authority.js";

const reference=z.string().min(1).max(191);
const discovery=z.array(z.strictObject({isolation:z.literal("read committed"),candidates:z.array(z.strictObject({
  merchantId:reference,sessionId:reference,cartRef:reference,
})).max(2)})).length(1);

/** READ only. Presence dispatch is not financial authority. The merchant fence
 * precedes discovery, so a concurrent normal acceptance cannot race an absent
 * result into the legacy cart-first reader. Never call after a cart lock. */
export async function readNormalCheckoutSourceProjection(tx:Prisma.TransactionClient,scope:{merchantId:string;cartId:string}){
  try{return await readProjection(tx,scope);}catch(error){
    if(error instanceof NormalCheckoutProductFulfillmentError)return requireNormalCrossSellReview(error.code);
    if(error instanceof z.ZodError||error instanceof FoodOptionValidationError||error instanceof SyntaxError)return requireNormalCrossSellReview("source_invalid");
    if(error instanceof StorefrontCouponEligibilityReviewRequired)return requireNormalCrossSellReview(error.reason);
    if(error instanceof Error&&Object.getPrototypeOf(error)===Error.prototype&&error.message==="checkout_coupon_binding_conflict")return requireNormalCrossSellReview("coupon_owner_required");
    throw error;
  }
}
async function readProjection(tx:Prisma.TransactionClient,scope:{merchantId:string;cartId:string}){
  const {merchantId,cartId}=z.strictObject({merchantId:reference,cartId:reference}).parse(scope);
  // Separate statement is essential: the discovery must acquire a NEW RC
  // snapshot after any wait for an accepting transaction's merchant fence.
  const merchantCount=await tx.$executeRaw`SELECT id FROM merchants WHERE id=${merchantId} FOR UPDATE`;
  if(merchantCount!==1)return requireNormalCrossSellReview("source_owner_invalid");
  const raw=await tx.$queryRaw`SELECT current_setting('transaction_isolation') AS isolation,
    COALESCE((SELECT jsonb_agg(candidate) FROM (
      SELECT s.merchant_id AS "merchantId",s.session_id AS "sessionId",s.cart->>'cart_ref' AS "cartRef"
      FROM checkout_sessions s WHERE s.merchant_id=${merchantId} AND s.cart->>'cart_ref'=${cartId}
        AND (EXISTS (SELECT 1 FROM cross_sell_suggestions a WHERE a.merchant_id=s.merchant_id AND a.session_id=s.session_id AND a.status='accepted'
            AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.cart->'items')='array' THEN s.cart->'items' ELSE '[]'::jsonb END) line
              WHERE line->'crossSellIntent'->>'promotionId'=a.promo_id AND line->>'sku'=ANY(a.ranked_items)))
          OR EXISTS (SELECT 1 FROM checkout_events e WHERE e.merchant_id=s.merchant_id AND e.session_id=s.session_id
            AND e.event_name='cross_sell_accepted' AND strpos(e.metadata->>'acceptance_event_id','normal_cross_sell_')=1)
          OR EXISTS (SELECT 1 FROM outbox_messages o WHERE o.merchant_id=s.merchant_id
            AND o.event_type='cross-sell.offer.accepted' AND o.producer='cross-sell'
            AND o.payload->'ack'->>'sessionId'=s.session_id))
      LIMIT 2
    ) candidate),'[]'::jsonb) AS candidates /* normal_checkout_source_read */`;
  const parsed=discovery.safeParse(raw);
  if(!parsed.success)return requireNormalCrossSellReview("source_owner_invalid");
  const candidates=parsed.data[0]!.candidates;
  if(candidates.length===0)return undefined;
  if(candidates.length!==1)return requireNormalCrossSellReview("source_owner_ambiguous");
  const owner=candidates[0]!;
  if(owner.merchantId!==merchantId||owner.cartRef!==cartId)return requireNormalCrossSellReview("source_owner_invalid");
  const checkoutScope={merchantId,sessionId:owner.sessionId};
  await lockNormalCheckoutCrossSell(tx,checkoutScope);
  const current=await readNormalCheckoutCrossSellAuthority(tx,checkoutScope);
  if(!current.source||current.source.row.merchantId!==merchantId||current.source.row.sessionId!==cartId
    ||current.acceptanceEventIds.length===0)return requireNormalCrossSellReview("accepted_evidence_invalid");
  const source:StorefrontCart={...current.source.row,items:current.source.basis.items};
  const cart:StorefrontCart={...source,items:source.items.map(item=>{
    const matches=current.pricing.items.filter(line=>storefrontOptionLineIdentity(line)===storefrontOptionLineIdentity(item));
    if(matches.length!==1)return requireNormalCrossSellReview("source_changed");
    const line=matches[0]!;
    return {...item,unitPriceCents:line.unitPriceCents,...(line.unitPriceCents===line.baseUnitPriceCents?{}
      :{pricingOriginalUnitPriceCents:line.baseUnitPriceCents})};
  }),total:current.pricing.merchandiseSubtotalCents,discount:current.pricing.cartDiscountCents,freeShipping:false,
    discountBudget:{version:1,originalSubtotalCents:current.pricing.originalSubtotalCents,promotionDiscountCents:current.pricing.promotionDiscountCents},
    ...(current.pricing.notice?{commercialNotices:[commercialNotice(current.pricing.notice)]}:{})};
  return {source,cart,costsByVariant:new Map<string,number>() as ReadonlyMap<string,number>};
}
