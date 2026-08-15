import type { CouponSnapshot } from "../entities/coupon.entity.js";

/**
 * Calculate discount amount in cents for a given coupon + cart total.
 * Shipping-type coupons return 0 here — they are applied to shipping cost separately.
 */
export function calculateCouponDiscount(coupon: CouponSnapshot, cartTotal: number): number {
  if (coupon.discount_type === "percent") {
    const cappedPercent = Math.min(coupon.discount_value, 100);
    const discount = (cartTotal * cappedPercent) / 100;
    return Math.min(discount, cartTotal);
  }
  if (coupon.discount_type === "fixed") {
    return Math.min(cartTotal, coupon.discount_value);
  }
  // shipping_free, shipping_percent, shipping_fixed → no cart discount
  return 0;
}

/**
 * Calculate shipping discount for shipping-type coupons.
 */
export function calculateShippingDiscount(coupon: CouponSnapshot, shippingCostCents: number): number {
  if (coupon.discount_type === "shipping_free") {
    return shippingCostCents; // full waiver
  }
  if (coupon.discount_type === "shipping_percent") {
    const cappedPercent = Math.min(coupon.discount_value, 100);
    return Math.round((shippingCostCents * cappedPercent) / 100);
  }
  if (coupon.discount_type === "shipping_fixed") {
    return Math.min(coupon.discount_value, shippingCostCents);
  }
  return 0;
}
