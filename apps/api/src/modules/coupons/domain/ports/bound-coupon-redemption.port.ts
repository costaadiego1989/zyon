export const BOUND_COUPON_REDEMPTION = Symbol("BOUND_COUPON_REDEMPTION");

/** Internal persisted source reference, never a browser-supplied authority. */
export interface BoundCouponRedemption {
  redeem(input: { merchantId: string; eventId: string }): Promise<void>;
}
