import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateCoupon } from "./coupon-validity.policy.js";
import { checkCouponLimits } from "./coupon-limit.policy.js";
import type { CouponSnapshot } from "../entities/coupon.entity.js";
import type { Cart } from "@aacp/shared-types";

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
    starts_at: new Date(Date.now() - 1000).toISOString(),
    ends_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeCart(overrides: Partial<Cart> = {}): Cart {
  return {
    items: [{ sku: "SKU-A", price: 100, quantity: 1, name: "Item A" }],
    total: 100,
    currency: "BRL",
    ...overrides,
  };
}

describe("coupon-validity.policy", () => {
  it("accepts valid active coupon", () => {
    assert.deepEqual(validateCoupon(makeCoupon(), makeCart()), { valid: true });
  });

  it("rejects non-active coupon", () => {
    const result = validateCoupon(makeCoupon({ status: "archived" }), makeCart());
    assert.equal(result.valid, false);
    if (!result.valid) assert.equal(result.reason, "COUPON_INVALID");
  });

  it("rejects coupon not yet started", () => {
    const result = validateCoupon(makeCoupon({ starts_at: new Date(Date.now() + 3_600_000).toISOString() }), makeCart());
    assert.equal(result.valid, false);
    if (!result.valid) assert.equal(result.reason, "COUPON_NOT_YET_ACTIVE");
  });

  it("rejects expired coupon", () => {
    const result = validateCoupon(makeCoupon({ ends_at: new Date(Date.now() - 1000).toISOString() }), makeCart());
    assert.equal(result.valid, false);
    if (!result.valid) assert.equal(result.reason, "COUPON_EXPIRED");
  });

  it("rejects when cart total below minimum", () => {
    const result = validateCoupon(makeCoupon({ min_cart_total: 200 }), makeCart({ total: 100 }));
    assert.equal(result.valid, false);
    if (!result.valid) assert.equal(result.reason, "COUPON_MIN_CART_NOT_MET");
  });

  it("rejects when no allowed SKU present in cart", () => {
    const result = validateCoupon(makeCoupon({ allowed_skus: ["SKU-Z"] }), makeCart());
    assert.equal(result.valid, false);
    if (!result.valid) assert.equal(result.reason, "COUPON_SKU_NOT_ALLOWED");
  });

  it("accepts when allowed SKU is in cart", () => {
    const result = validateCoupon(makeCoupon({ allowed_skus: ["SKU-A"] }), makeCart());
    assert.equal(result.valid, true);
  });

  it("rejects when blocked SKU is in cart", () => {
    const result = validateCoupon(makeCoupon({ blocked_skus: ["SKU-A"] }), makeCart());
    assert.equal(result.valid, false);
    if (!result.valid) assert.equal(result.reason, "COUPON_SKU_BLOCKED");
  });

  it("rejects when buyer region not in allowed list", () => {
    const result = validateCoupon(makeCoupon({ allowed_regions: ["SP"] }), makeCart(), "RJ");
    assert.equal(result.valid, false);
    if (!result.valid) assert.equal(result.reason, "COUPON_REGION_NOT_ALLOWED");
  });

  it("accepts when buyer region is in allowed list", () => {
    const result = validateCoupon(makeCoupon({ allowed_regions: ["SP"] }), makeCart(), "SP");
    assert.equal(result.valid, true);
  });

  it("rejects when buyer region is blocked", () => {
    const result = validateCoupon(makeCoupon({ blocked_regions: ["RJ"] }), makeCart(), "RJ");
    assert.equal(result.valid, false);
    if (!result.valid) assert.equal(result.reason, "COUPON_REGION_BLOCKED");
  });

  it("accepts when buyer region is not blocked", () => {
    const result = validateCoupon(makeCoupon({ blocked_regions: ["RJ"] }), makeCart(), "SP");
    assert.equal(result.valid, true);
  });
});

describe("coupon-limit.policy", () => {
  it("allows when no limits configured", () => {
    assert.deepEqual(checkCouponLimits(makeCoupon(), 9999, 9999), { allowed: true });
  });

  it("rejects when global usages reach max_usages", () => {
    const result = checkCouponLimits(makeCoupon({ max_usages: 100 }), 100, 0);
    assert.equal(result.allowed, false);
    if (!result.allowed) assert.equal(result.reason, "COUPON_EXHAUSTED");
  });

  it("allows when global usages below max_usages", () => {
    assert.equal(checkCouponLimits(makeCoupon({ max_usages: 100 }), 99, 0).allowed, true);
  });

  it("rejects when buyer usages reach max_per_buyer", () => {
    const result = checkCouponLimits(makeCoupon({ max_per_buyer: 1 }), 0, 1);
    assert.equal(result.allowed, false);
    if (!result.allowed) assert.equal(result.reason, "COUPON_PER_BUYER_LIMIT_REACHED");
  });

  it("allows when buyer usages below max_per_buyer", () => {
    assert.equal(checkCouponLimits(makeCoupon({ max_per_buyer: 3 }), 0, 2).allowed, true);
  });
});
