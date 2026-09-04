import { Injectable } from "@nestjs/common";
import { CouponEntity } from "../../domain/entities/coupon.entity.js";
import type { CouponRepository } from "../../domain/ports/coupon-repository.port.js";

@Injectable()
export class InMemoryCouponRepository implements CouponRepository {
  private readonly store = new Map<string, CouponEntity>();

  async save(coupon: CouponEntity): Promise<void> {
    this.store.set(coupon.id, coupon);
  }

  async findById(id: string, merchantId: string): Promise<CouponEntity | null> {
    const c = this.store.get(id);
    if (!c || c.merchant_id !== merchantId) return null;
    return c;
  }

  async findByCode(merchantId: string, code: string): Promise<CouponEntity | null> {
    const upper = code.toUpperCase();
    for (const c of this.store.values()) {
      if (c.merchant_id === merchantId && c.code === upper) return c;
    }
    return null;
  }

  async findAllByMerchant(merchantId: string): Promise<CouponEntity[]> {
    return [...this.store.values()].filter((c) => c.merchant_id === merchantId);
  }

  async updateActive(_merchantId: string, id: string, isActive: boolean): Promise<void> {
    const coupon = this.store.get(id);
    if (coupon) {
      (coupon as any).is_active = isActive;
    }
  }
}
