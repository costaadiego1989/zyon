import { Injectable } from "@nestjs/common";
import { CouponRedemptionEntity } from "../../domain/entities/coupon-redemption.entity.js";
import type { CouponRedemptionRepository } from "../../domain/ports/coupon-redemption-repository.port.js";

@Injectable()
export class InMemoryCouponRedemptionRepository implements CouponRedemptionRepository {
  private readonly store = new Map<string, CouponRedemptionEntity>();

  async save(redemption: CouponRedemptionEntity): Promise<void> {
    this.store.set(redemption.id, redemption);
  }

  async findById(id: string, merchantId: string): Promise<CouponRedemptionEntity | null> {
    const r = this.store.get(id);
    // P2 fix: scope by merchantId so cross-tenant reads are impossible
    if (!r || r.merchant_id !== merchantId) return null;
    return r;
  }

  async findBySession(sessionId: string, merchantId: string): Promise<CouponRedemptionEntity[]> {
    return [...this.store.values()].filter((r) => r.session_id === sessionId && r.merchant_id === merchantId);
  }

  async countByBuyer(couponId: string, buyerGlobalUserId: string): Promise<number> {
    return [...this.store.values()].filter(
      (r) => r.coupon_id === couponId && r.snapshot().buyer_global_user_id === buyerGlobalUserId && r.status !== "cancelled"
    ).length;
  }

  async countByCoupon(couponId: string): Promise<number> {
    // P1 fix: count "applied" + "redeemed" so in-flight applies eat into max_usages
    return [...this.store.values()].filter(
      (r) => r.coupon_id === couponId && r.status !== "cancelled"
    ).length;
  }
}
