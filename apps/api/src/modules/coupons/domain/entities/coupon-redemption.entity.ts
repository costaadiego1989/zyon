import { randomUUID } from "node:crypto";

export type RedemptionStatus = "applied" | "redeemed" | "cancelled";
export type RedemptionSource = "manual" | "auto";

export type CouponRedemptionSnapshot = {
  id: string;
  coupon_id: string;
  merchant_id: string;
  session_id: string;
  buyer_global_user_id: string | null;
  discount_applied: number;
  source: RedemptionSource;
  status: RedemptionStatus;
  order_id: string | null;
  created_at: string;
  updated_at: string;
};

export class CouponRedemptionEntity {
  private constructor(private readonly s: CouponRedemptionSnapshot) {}

  static create(input: {
    coupon_id: string;
    merchant_id: string;
    session_id: string;
    buyer_global_user_id: string | null;
    discount_applied: number;
    source: RedemptionSource;
  }): CouponRedemptionEntity {
    const now = new Date().toISOString();
    return new CouponRedemptionEntity({
      id: randomUUID(),
      ...input,
      status: "applied",
      order_id: null,
      created_at: now,
      updated_at: now
    });
  }

  static rehydrate(s: CouponRedemptionSnapshot): CouponRedemptionEntity {
    return new CouponRedemptionEntity(s);
  }

  redeem(orderId: string): CouponRedemptionEntity {
    if (this.s.status !== "applied") throw new Error("illegal_transition");
    return new CouponRedemptionEntity({
      ...this.s,
      status: "redeemed",
      order_id: orderId,
      updated_at: new Date().toISOString()
    });
  }

  cancel(): CouponRedemptionEntity {
    if (this.s.status !== "applied") throw new Error("illegal_transition");
    return new CouponRedemptionEntity({ ...this.s, status: "cancelled", updated_at: new Date().toISOString() });
  }

  snapshot(): CouponRedemptionSnapshot { return { ...this.s }; }
  get id(): string { return this.s.id; }
  get coupon_id(): string { return this.s.coupon_id; }
  get session_id(): string { return this.s.session_id; }
  get merchant_id(): string { return this.s.merchant_id; }
  get status(): RedemptionStatus { return this.s.status; }
}
