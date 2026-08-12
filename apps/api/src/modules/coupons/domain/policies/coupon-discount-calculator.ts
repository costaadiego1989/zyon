import type { CouponSnapshot } from "../entities/coupon.entity.js";

export function calculateCouponDiscount(coupon: CouponSnapshot, cartTotal: number): number {
  if (coupon.discount_type === "percent") {
    const cappedPercent = Math.min(coupon.discount_value, 100);
    const discount = (cartTotal * cappedPercent) / 100;
    return Math.min(discount, cartTotal);
  }
  return Math.min(cartTotal, coupon.discount_value);
}
