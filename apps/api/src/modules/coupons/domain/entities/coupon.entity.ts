import { randomUUID } from "node:crypto";
import {
  CouponMerchantRequiredError,
  CouponCodeRequiredError,
  CouponDiscountValueInvalidError,
} from "../errors.js";

export type CouponDiscountType = "percent" | "fixed" | "shipping_free" | "shipping_percent" | "shipping_fixed";
export type CouponStatus = "active" | "expired" | "archived";

export type CouponSnapshot = {
  id: string;
  merchant_id: string;
  code: string;
  discount_type: CouponDiscountType;
  discount_value: number;
  min_cart_total: number | null;
  max_usages: number | null;
  max_per_buyer: number | null;
  usages_count: number;
  allowed_skus: string[];
  blocked_skus: string[];
  allowed_regions: string[];
  blocked_regions: string[];
  status: CouponStatus;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
};

export class CouponEntity {
  private constructor(private readonly s: CouponSnapshot) {}

  static create(input: Omit<CouponSnapshot, "id" | "usages_count" | "status" | "created_at" | "updated_at">): CouponEntity {
    if (!input.merchant_id.trim()) throw new CouponMerchantRequiredError();
    if (!input.code.trim()) throw new CouponCodeRequiredError();
    if (input.discount_value < 0) throw new CouponDiscountValueInvalidError(input.discount_value);
    if (input.discount_type !== "shipping_free" && input.discount_value <= 0) throw new CouponDiscountValueInvalidError(input.discount_value);
    const now = new Date().toISOString();
    return new CouponEntity({
      ...input,
      id: randomUUID(),
      code: input.code.toUpperCase().trim(),
      usages_count: 0,
      status: "active",
      created_at: now,
      updated_at: now
    });
  }

  static rehydrate(s: CouponSnapshot): CouponEntity {
    return new CouponEntity(s);
  }

  incrementUsage(): CouponEntity {
    return new CouponEntity({ ...this.s, usages_count: this.s.usages_count + 1, updated_at: new Date().toISOString() });
  }

  archive(): CouponEntity {
    return new CouponEntity({ ...this.s, status: "archived", updated_at: new Date().toISOString() });
  }

  update(patch: Partial<Pick<CouponSnapshot, "discount_type" | "discount_value" | "min_cart_total" | "max_usages" | "max_per_buyer" | "allowed_skus" | "blocked_skus" | "allowed_regions" | "blocked_regions" | "starts_at" | "ends_at">>): CouponEntity {
    return new CouponEntity({ ...this.s, ...patch, updated_at: new Date().toISOString() });
  }

  snapshot(): CouponSnapshot { return { ...this.s }; }
  get id(): string { return this.s.id; }
  get merchant_id(): string { return this.s.merchant_id; }
  get code(): string { return this.s.code; }
  get status(): CouponStatus { return this.s.status; }
}
