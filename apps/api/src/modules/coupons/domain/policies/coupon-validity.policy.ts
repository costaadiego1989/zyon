import type { Cart } from "@aacp/shared-types";
import type { CouponSnapshot } from "../entities/coupon.entity.js";

export type CouponValidityResult =
  | { valid: true }
  | { valid: false; reason: string };

export function validateCoupon(coupon: CouponSnapshot, cart: Cart, buyerRegion?: string): CouponValidityResult {
  const now = new Date();

  if (coupon.status !== "active") return { valid: false, reason: "COUPON_INVALID" };
  if (new Date(coupon.starts_at) > now) return { valid: false, reason: "COUPON_NOT_YET_ACTIVE" };
  if (coupon.ends_at && new Date(coupon.ends_at) < now) return { valid: false, reason: "COUPON_EXPIRED" };
  if (coupon.min_cart_total !== null && cart.total < coupon.min_cart_total) return { valid: false, reason: "COUPON_MIN_CART_NOT_MET" };

  const cartSkus = cart.items.map((i) => i.sku);
  if (coupon.allowed_skus.length > 0 && !cartSkus.some((sku) => coupon.allowed_skus.includes(sku))) {
    return { valid: false, reason: "COUPON_SKU_NOT_ALLOWED" };
  }
  if (coupon.blocked_skus.length > 0 && cartSkus.some((sku) => coupon.blocked_skus.includes(sku))) {
    return { valid: false, reason: "COUPON_SKU_BLOCKED" };
  }
  if (buyerRegion) {
    if (coupon.allowed_regions.length > 0 && !coupon.allowed_regions.includes(buyerRegion)) {
      return { valid: false, reason: "COUPON_REGION_NOT_ALLOWED" };
    }
    if (coupon.blocked_regions.length > 0 && coupon.blocked_regions.includes(buyerRegion)) {
      return { valid: false, reason: "COUPON_REGION_BLOCKED" };
    }
  }

  return { valid: true };
}
