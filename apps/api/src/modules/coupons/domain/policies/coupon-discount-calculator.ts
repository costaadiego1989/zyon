import type { CouponSnapshot } from "../entities/coupon.entity.js";

/**
 * Calculate discount in major currency units; round down to a cent so caps hold.
 * Shipping-type coupons return 0 here — they are applied to shipping cost separately.
 */
export function calculateCouponDiscount(coupon: CouponSnapshot, cartTotal: number): number {
  if (coupon.discount_type === "percent") {
    const cappedPercent = Math.min(coupon.discount_value, 100);
    const discount = (cartTotal * cappedPercent) / 100;
    return Math.floor(Number((Math.min(discount, cartTotal) * 100).toFixed(6))) / 100;
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
export function calculateShippingDiscount(coupon: CouponSnapshot, shippingPrice: number): number {
  if (coupon.discount_type === "shipping_free") {
    return shippingPrice; // full waiver, in major units
  }
  if (coupon.discount_type === "shipping_percent") {
    const cappedPercent = Math.min(coupon.discount_value, 100);
    return Math.floor(Number((shippingPrice * cappedPercent).toFixed(6))) / 100;
  }
  if (coupon.discount_type === "shipping_fixed") {
    return Math.min(coupon.discount_value, shippingPrice);
  }
  return 0;
}
