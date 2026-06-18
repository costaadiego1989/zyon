import type { CouponRedemptionEntity } from "../entities/coupon-redemption.entity.js";

export const COUPON_REDEMPTION_REPOSITORY = Symbol("COUPON_REDEMPTION_REPOSITORY");

export interface CouponRedemptionRepository {
  save(redemption: CouponRedemptionEntity): Promise<void>;
  /** P2 fix: merchantId scopes the lookup to prevent cross-tenant reads */
  findById(id: string, merchantId: string): Promise<CouponRedemptionEntity | null>;
  findBySession(sessionId: string, merchantId: string): Promise<CouponRedemptionEntity[]>;
  countByBuyer(couponId: string, buyerGlobalUserId: string): Promise<number>;
  countByCoupon(couponId: string): Promise<number>;
}
