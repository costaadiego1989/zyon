import type { CouponRedemptionEntity } from "../entities/coupon-redemption.entity.js";

export const COUPON_REDEMPTION_REPOSITORY = Symbol("COUPON_REDEMPTION_REPOSITORY");

export interface CouponRedemptionRepository {
  save(redemption: CouponRedemptionEntity): Promise<void>;
  findById(id: string): Promise<CouponRedemptionEntity | null>;
  findBySession(sessionId: string, merchantId: string): Promise<CouponRedemptionEntity[]>;
  countByBuyer(couponId: string, buyerGlobalUserId: string): Promise<number>;
  countByCoupon(couponId: string): Promise<number>;
}
