import { z } from "zod";

const ref=z.string().min(1).max(191).refine(value=>value.trim()===value&&!/[\u0000-\u001f\u007f]/.test(value));
/** Immutable comparison references only. Actual coupon/reservation/event rows
 * must independently authorize initial admission and the first provider send. */
export const normalCheckoutCouponDiscountOwnerSchema=z.strictObject({
  kind:z.literal("checkout_coupon"),merchantId:ref,checkoutSessionId:ref,buyerId:ref,reservationBuyerId:ref.nullable(),
  couponId:ref,redemptionId:ref,code:ref,discountCents:z.number().int().positive().max(2_147_483_647),
  applicationEventId:ref,reservationUpdatedAt:z.iso.datetime({offset:true}),
});
export type NormalCheckoutCouponDiscountOwner=z.infer<typeof normalCheckoutCouponDiscountOwnerSchema>;
