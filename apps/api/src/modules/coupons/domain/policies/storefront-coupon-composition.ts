import { z } from "zod";
import { evaluateCombinedDiscount, moneyCents } from "@zyon/rules-engine";
import { authorizeShippingDiscount } from "@zyon/shipping-engine";
import { calculateCouponDiscount, calculateShippingDiscount } from "./coupon-discount-calculator.js";
import { validateCoupon } from "./coupon-validity.policy.js";
import { commercialNotice } from "../../../storefront/domain/services/commercial-notice.js";
import { commercialNoticesSchema } from "../../../storefront/domain/contracts/commercial-notice.schemas.js";

const ref = z.string().min(1).max(191).refine(value => value.trim() === value && !value.includes("\0"));
const cents = z.number().int().nonnegative().max(2_147_483_647);
const money = z.number().nonnegative().refine(value => moneyCents(value) !== null);
const date = z.iso.datetime({ offset: true });
const couponSchema = z.strictObject({ id: ref, merchant_id: ref, code: ref,
  strategy_incentive_execution_id: ref.nullable().optional(),
  discount_type: z.enum(["percent", "fixed", "shipping_free", "shipping_percent", "shipping_fixed"]), discount_value: z.number().finite().nonnegative(),
  min_cart_total: money.nullable(), max_usages: cents.nullable(), max_per_buyer: cents.nullable(), usages_count: cents,
  allowed_skus: z.array(ref).max(1000), blocked_skus: z.array(ref).max(1000), allowed_regions: z.array(ref).max(1000), blocked_regions: z.array(ref).max(1000),
  status: z.enum(["active", "paused", "expired", "archived"]), starts_at: date, ends_at: date.nullable(), created_at: date, updated_at: date,
}).refine(value => ["percent", "shipping_percent"].includes(value.discount_type) ? value.discount_value <= 100
  : moneyCents(value.discount_value) !== null);
const shippingSchema = z.strictObject({ quoteKey: ref, destination: ref, expiresAt: date,
  customerPrice: money, realCost: money, region: ref.optional() });
const ruleSchema = z.strictObject({ maxDiscountPercent: z.number().finite().min(0).max(100), minimumMarginPercent: z.unknown().optional(),
  allowFreeShipping: z.boolean(), allowShippingDiscount: z.boolean(), allowBonusItem: z.boolean(), allowStackDiscountAndFreeShipping: z.boolean(),
  freeShippingMinCartValue: money, maxShippingSubsidy: money, maxPartialShippingDiscount: money, offerExpirationMinutes: z.number().positive(),
  blockedRegions: z.array(ref).max(1000), brandVoice: z.enum(["consultative", "aggressive", "premium", "young", "technical", "popular"]),
  couponBoxEnabled: z.boolean(), autonomousEngineEnabled: z.boolean(),
});
const inputSchema = z.strictObject({ now: date, scope: z.strictObject({ merchantId: ref, cartId: ref, buyerId: ref }), coupon: couponSchema,
  reservation: z.strictObject({ id: ref, merchantId: ref, cartId: ref, buyerId: ref.nullable(), couponId: ref,
    discountCents: cents, status: z.literal("applied") }),
  cart: z.strictObject({ currency: z.literal("BRL"), total: money, currentDiscount: money,
    items: z.array(z.strictObject({ sku: ref, variantId: ref, product_id: ref, name: z.string().min(1).max(1000),
      quantity: z.number().int().min(1).max(99), price: money, originalPrice: money.optional() })).min(1).max(200),
    discountBudget: z.strictObject({ version: z.literal(1), originalSubtotalCents: cents, promotionDiscountCents: cents }),
  }), rules: ruleSchema, shipping: shippingSchema.optional(),
});

/** Monetary candidate ONLY. Neither its shape nor matching values prove source,
 * quota, combination permission, ownership, issuance or an admitted payment. */
export const storefrontCouponCompositionCandidateSchema = z.strictObject({ version: z.literal(2), kind: z.literal("candidate"),
  merchantId: ref, cartId: ref, buyerId: ref, reservationBuyerId: ref.nullable(), couponId: ref, redemptionId: ref,
  couponUpdatedAt: date, couponCode: ref, benefit: z.enum(["merchandise", "shipping"]),
  originalSubtotalCents: cents, promotionDiscountCents: cents, merchandiseSubtotalCents: cents, merchandiseDiscountCents: cents,
  merchandiseTotalCents: cents, shippingOriginalPriceCents: cents, shippingDiscountCents: cents, shippingPriceCents: cents, totalCents: cents,
  shippingQuote: shippingSchema.optional(), commercialNotices: commercialNoticesSchema.optional(),
}).refine(value => BigInt(value.originalSubtotalCents) - BigInt(value.promotionDiscountCents) === BigInt(value.merchandiseSubtotalCents)
  && BigInt(value.merchandiseSubtotalCents) - BigInt(value.merchandiseDiscountCents) === BigInt(value.merchandiseTotalCents)
  && BigInt(value.shippingOriginalPriceCents) - BigInt(value.shippingDiscountCents) === BigInt(value.shippingPriceCents)
  && BigInt(value.merchandiseTotalCents) + BigInt(value.shippingPriceCents) === BigInt(value.totalCents)
  && (value.reservationBuyerId === null || value.reservationBuyerId === value.buyerId)
  && (value.shippingQuote ? moneyCents(value.shippingQuote.customerPrice) === value.shippingOriginalPriceCents : value.shippingOriginalPriceCents === 0)
  && (value.benefit === "shipping" ? value.merchandiseDiscountCents === 0 && value.shippingDiscountCents > 0 && value.shippingQuote !== undefined
    : value.merchandiseDiscountCents > 0 && value.shippingDiscountCents === 0));
const reviewSchema = z.strictObject({ version: z.literal(2), kind: z.literal("requires_review"),
  reason: z.enum(["coupon_conditions_changed", "discount_ceiling_changed", "shipping_stacking_changed", "shipping_conditions_changed"]),
  commercialNotices: commercialNoticesSchema,
});
export const storefrontCouponCompositionResultSchema = z.discriminatedUnion("kind", [storefrontCouponCompositionCandidateSchema, reviewSchema]);
export type StorefrontCouponCompositionCandidate = z.output<typeof storefrontCouponCompositionCandidateSchema>;

function conflict(): never { throw new Error("storefront_coupon_composition_conflict"); }
function checked<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  try { const result = schema.safeParse(value); if (result.success) return result.data; } catch { /* fixed boundary */ }
  return conflict();
}
function toCents(value: number): number { return moneyCents(value) ?? conflict(); }

/** Pure pre-admission calculation. A caller must reread canonical snapshots and
 * enforce combination/quota/source ownership under the common transaction fences.
 * This does not resize, transfer, consume or release an existing reservation. */
export function prepareStorefrontCouponComposition(raw: unknown): z.output<typeof storefrontCouponCompositionResultSchema> {
  const { now: observedAt, scope, coupon, reservation, cart, rules: ruleSnapshot, shipping } = checked(inputSchema, raw);
  const { minimumMarginPercent: _informationalMargin, ...rules } = ruleSnapshot;
  const now = new Date(observedAt);
  if (coupon.merchant_id !== scope.merchantId || reservation.merchantId !== scope.merchantId
    || reservation.cartId !== scope.cartId || reservation.couponId !== coupon.id
    || reservation.buyerId !== null && reservation.buyerId !== scope.buyerId
    || coupon.strategy_incentive_execution_id || reservation.discountCents !== toCents(cart.currentDiscount)) return conflict();
  // Original unit prices must contain P+D already, not a second options charge.
  const originals = cart.items.reduce((sum, item) => sum + BigInt(toCents(item.originalPrice ?? item.price)) * BigInt(item.quantity), 0n);
  if (originals !== BigInt(cart.discountBudget.originalSubtotalCents)
    || cart.items.some(item => (item.originalPrice ?? item.price) < item.price)) return conflict();
  const goods = evaluateCombinedDiscount(cart, rules, reservation.discountCents);
  if (["economic_input_invalid", "cart_total_mismatch", "discount_budget_invalid", "cart_items_missing"].includes(goods.reason)) return conflict();
  const review = (reason: z.output<typeof reviewSchema>["reason"]) => checked(reviewSchema, { version: 2, kind: "requires_review", reason,
    commercialNotices: [commercialNotice(reason === "discount_ceiling_changed" ? "discount_limit_reached"
      : reason === "shipping_stacking_changed" ? "benefit_not_combinable" : "benefit_conditions_not_met")] });
  if (goods.kind !== "authorized" || goods.cartDiscountCents !== reservation.discountCents) return review("discount_ceiling_changed");
  if (coupon.allowed_regions.length + coupon.blocked_regions.length > 0 && !shipping?.region) return review("coupon_conditions_changed");
  if (!validateCoupon(coupon, cart, shipping?.region, now).valid) return review("coupon_conditions_changed");
  const shippingCoupon = ["shipping_free", "shipping_percent", "shipping_fixed"].includes(coupon.discount_type);
  let shippingDiscountCents = 0;
  if (shippingCoupon) {
    if (reservation.discountCents !== 0) return conflict();
    if (!shipping || Date.parse(shipping.expiresAt) <= now.getTime()) return review("shipping_conditions_changed");
    // The shipping engine's legacy currentDiscount field alone does not include
    // line promotions. Preserve explicit stacking policy for BOTH sources.
    if (!rules.allowStackDiscountAndFreeShipping && goods.totalDiscountCents > 0) return review("shipping_stacking_changed");
    const requestedDiscount = calculateShippingDiscount(coupon, shipping.customerPrice);
    const grant = authorizeShippingDiscount({ cart, rules, shipping, requestedDiscount,
      type: coupon.discount_type === "shipping_free" ? "shipping_free" : "shipping_discount_fixed" });
    if (!grant.approved) return review("shipping_conditions_changed");
    shippingDiscountCents = toCents(grant.value);
  } else {
    if (reservation.discountCents <= 0) return conflict();
    if (toCents(calculateCouponDiscount(coupon, cart.total)) < reservation.discountCents) return review("coupon_conditions_changed");
    if (shipping && Date.parse(shipping.expiresAt) <= now.getTime()) return review("shipping_conditions_changed");
    if (shipping && shipping.customerPrice === 0 && shipping.realCost > 0 && !rules.allowStackDiscountAndFreeShipping) return review("shipping_stacking_changed");
  }
  const merchandiseSubtotalCents = toCents(cart.total), merchandiseTotalCents = merchandiseSubtotalCents - reservation.discountCents;
  const shippingOriginalPriceCents = shipping ? toCents(shipping.customerPrice) : 0;
  const shippingPriceCents = shippingOriginalPriceCents - shippingDiscountCents;
  return checked(storefrontCouponCompositionCandidateSchema, { version: 2, kind: "candidate", ...scope,
    reservationBuyerId: reservation.buyerId, couponId: coupon.id, redemptionId: reservation.id, couponCode: coupon.code, couponUpdatedAt: coupon.updated_at,
    benefit: shippingCoupon ? "shipping" : "merchandise", originalSubtotalCents: goods.originalSubtotalCents, promotionDiscountCents: goods.promotionDiscountCents,
    merchandiseSubtotalCents, merchandiseDiscountCents: reservation.discountCents, merchandiseTotalCents,
    shippingOriginalPriceCents, shippingDiscountCents, shippingPriceCents, totalCents: merchandiseTotalCents + shippingPriceCents,
    ...(shipping ? { shippingQuote: shipping } : {}),
    ...(goods.totalDiscountCents > 0 && goods.remainingDiscountCents === 0 ? { commercialNotices: [commercialNotice("discount_limit_reached")] } : {}),
  });
}
