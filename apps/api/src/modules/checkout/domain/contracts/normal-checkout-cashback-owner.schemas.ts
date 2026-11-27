import { z } from "zod";
import { normalCheckoutCouponDiscountOwnerSchema } from "../../../coupons/domain/contracts/normal-checkout-coupon-owner.schema.js";
import { normalCheckoutPolicyDiscountOwnerSchema, normalCheckoutAcceptedOfferDiscountOwnerSchema } from "./normal-commercial-benefit-proof.schemas.js";

const ref = z.string().min(1).max(191), cents = z.number().int().positive().max(2_147_483_647);
export const normalStorefrontCouponComponentSchema = z.strictObject({ kind: z.literal("storefront_coupon"),
  merchantId: ref, checkoutSessionId: ref, buyerId: ref, cartId: ref, reservationBuyerId: ref.nullable(),
  redemptionId: ref, couponId: ref, code: ref, discountCents: cents });
/** Frozen comparison evidence only. The issuer must re-read every component
 * from its real reservation/accepted-offer/policy proof in the same SQL tx. */
export const normalCheckoutCashbackCombinationOwnerSchema = z.strictObject({ kind: z.literal("cashback_combination"),
  version: z.literal(1), merchantId: ref, checkoutSessionId: ref, buyerId: ref, discountCents: cents,
  cashbackRuleVersion: cents,
  commercialBenefitsVersion: cents, journalHash: z.string().regex(/^[a-f0-9]{64}$/),
  coupon: z.union([normalCheckoutCouponDiscountOwnerSchema, normalStorefrontCouponComponentSchema]).optional(),
  advanced: z.union([normalCheckoutPolicyDiscountOwnerSchema, normalCheckoutAcceptedOfferDiscountOwnerSchema]).optional(),
}).superRefine((value, context) => {
  const components = [value.coupon, value.advanced].filter((item): item is NonNullable<typeof item> => item !== undefined);
  if (!components.length || components.reduce((sum, item) => sum + item.discountCents, 0) !== value.discountCents
    || components.some(item => item.merchantId !== value.merchantId || item.checkoutSessionId !== value.checkoutSessionId || item.buyerId !== value.buyerId))
    context.addIssue({ code: "custom", message: "cashback_combination_owner_inconsistent" });
});
export type NormalCheckoutCashbackCombinationOwner = z.output<typeof normalCheckoutCashbackCombinationOwnerSchema>;
