import type { CouponEntity } from "../entities/coupon.entity.js";

export const COUPON_REPOSITORY = Symbol("COUPON_REPOSITORY");

export interface CouponRepository {
  save(coupon: CouponEntity): Promise<void>;
  findById(id: string, merchantId: string): Promise<CouponEntity | null>;
  findByCode(merchantId: string, code: string): Promise<CouponEntity | null>;
  findAllByMerchant(merchantId: string): Promise<CouponEntity[]>;
}
