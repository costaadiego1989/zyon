import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculateCouponDiscount } from "./coupon-discount-calculator.js";
import type { CouponSnapshot } from "../entities/coupon.entity.js";

function makeCoupon(overrides: Partial<CouponSnapshot> = {}): CouponSnapshot {
  return {
    id: "coup_1",
    merchant_id: "mrc_1",
    code: "SAVE10",
    discount_type: "percent",
    discount_value: 10,
    min_cart_total: null,
    max_usages: null,
    max_per_buyer: null,
    usages_count: 0,
    allowed_skus: [],
    blocked_skus: [],
    allowed_regions: [],
    blocked_regions: [],
    status: "active",
    starts_at: new Date().toISOString(),
    ends_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides
  };
}

describe("calculateCouponDiscount", () => {
  it("computes percent discount on cart total", () => {
    const coupon = makeCoupon({ discount_type: "percent", discount_value: 10 });
    assert.equal(calculateCouponDiscount(coupon, 100), 10);
    assert.equal(calculateCouponDiscount(coupon, 250), 25);
  });

  it("computes fixed discount on cart total", () => {
    const coupon = makeCoupon({ discount_type: "fixed", discount_value: 15 });
    assert.equal(calculateCouponDiscount(coupon, 100), 15);
  });

  it("caps percent discount at cart total (never negative cart)", () => {
    const coupon = makeCoupon({ discount_type: "percent", discount_value: 50 });
    assert.equal(calculateCouponDiscount(coupon, 30), 30);
  });

  it("caps fixed discount at cart total (never negative cart)", () => {
    const coupon = makeCoupon({ discount_type: "fixed", discount_value: 200 });
    assert.equal(calculateCouponDiscount(coupon, 80), 80);
  });

  it("returns 0 for zero cart total", () => {
    const percent = makeCoupon({ discount_type: "percent", discount_value: 25 });
    const fixed = makeCoupon({ discount_type: "fixed", discount_value: 25 });
    assert.equal(calculateCouponDiscount(percent, 0), 0);
    assert.equal(calculateCouponDiscount(fixed, 0), 0);
  });
});
