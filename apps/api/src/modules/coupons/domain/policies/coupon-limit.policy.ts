import type { CouponSnapshot } from "../entities/coupon.entity.js";

export type CouponLimitResult =
  | { allowed: true }
  | { allowed: false; reason: string };

export function checkCouponLimits(
  coupon: CouponSnapshot,
  globalUsagesCount: number,
  buyerUsagesCount: number
): CouponLimitResult {
  if (coupon.max_usages !== null && globalUsagesCount >= coupon.max_usages) {
    return { allowed: false, reason: "COUPON_EXHAUSTED" };
  }
  if (coupon.max_per_buyer !== null && buyerUsagesCount >= coupon.max_per_buyer) {
    return { allowed: false, reason: "COUPON_PER_BUYER_LIMIT_REACHED" };
  }
  return { allowed: true };
}
