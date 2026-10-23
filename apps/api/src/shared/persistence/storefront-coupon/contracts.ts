import type { CheckoutCouponPaymentAuthority } from "../../../modules/checkout/domain/services/checkout-coupon-binding.js";

/** Integration inputs are not an authorization grant. Their issuer must read
 * canonical source/reservation under the common transaction fences. */
export type StorefrontCouponAdmissionScope = {
  merchantId: string; checkoutSessionId: string; cartId: string; buyerId: string;
};
export type StorefrontCouponCheckoutCandidate = Omit<CheckoutCouponPaymentAuthority, "version" | "bindingId"> & { couponCode: string };
export type StorefrontCouponReviewReason = "source_expired" | "coupon_expired" | "coupon_region_changed" | "buyer_region_required"
  | "coupon_conditions_changed" | "discount_ceiling_changed" | "shipping_stacking_changed" | "coupon_quota_changed";
export class StorefrontCouponEligibilityReviewRequired extends Error {
  readonly candidate: Readonly<StorefrontCouponCheckoutCandidate>;
  constructor(readonly reason: StorefrontCouponReviewReason, candidate: StorefrontCouponCheckoutCandidate) {
    super("storefront_coupon_eligibility_review_required");
    this.name = "StorefrontCouponEligibilityReviewRequired";
    this.candidate = Object.freeze({ ...candidate });
  }
}
