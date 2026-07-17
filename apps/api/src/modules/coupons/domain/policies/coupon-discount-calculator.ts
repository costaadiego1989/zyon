import type { CouponSnapshot } from "../entities/coupon.entity.js";

export function calculateCouponDiscount(coupon: CouponSnapshot, cartTotal: number): number {
  if (coupon.discount_type === "percent") {
    // Cap percent discount at cart total to ensure post-discount cart never goes negative.
    // If discount_value exceeds cart, cap at cart; otherwise apply percent calculation.
    if (coupon.discount_value >= cartTotal) {
      return cartTotal;
    }
    return (cartTotal * coupon.discount_value) / 100;
  }
  return Math.min(cartTotal, coupon.discount_value);
}
