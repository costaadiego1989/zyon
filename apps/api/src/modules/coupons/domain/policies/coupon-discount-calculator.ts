import type { CouponSnapshot } from "../entities/coupon.entity.js";

export function calculateCouponDiscount(coupon: CouponSnapshot, cartTotal: number): number {
  if (coupon.discount_type === "percent") {
    return Math.min(cartTotal, (cartTotal * coupon.discount_value) / 100);
  }
  return Math.min(cartTotal, coupon.discount_value);
}
