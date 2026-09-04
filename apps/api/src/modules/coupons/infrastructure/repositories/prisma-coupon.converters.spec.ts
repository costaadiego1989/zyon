import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  toCouponEntity,
  toCouponCreateInput,
  toCouponUpdateInput,
  toCouponRedemptionEntity,
  toRedemptionCreateInput,
  toRedemptionUpdateInput
} from "./prisma-coupon.converters.js";
import { CouponEntity } from "../../domain/entities/coupon.entity.js";
import { CouponRedemptionEntity } from "../../domain/entities/coupon-redemption.entity.js";

describe("prisma-coupon converters", () => {
  it("toCouponEntity / toCouponCreateInput round-trip preserves all fields", () => {
    const coupon = CouponEntity.create({
      merchant_id: "mrc_1",
      code: "save10",
      discount_type: "percent",
      discount_value: 15,
      min_cart_total: 100,
      max_usages: 50,
      max_per_buyer: 2,
      allowed_skus: ["SKU-A"],
      blocked_skus: ["SKU-B"],
      allowed_regions: ["SP"],
      blocked_regions: ["RJ"],
      starts_at: new Date("2026-01-01T00:00:00Z").toISOString(),
      ends_at: new Date("2026-12-31T23:59:59Z").toISOString()
    });
    const snap = coupon.snapshot();
    const create = toCouponCreateInput(coupon);

    // Convert back via toCouponEntity using a Prisma-shaped row
    const rehydrated = toCouponEntity({
      id: create.id,
      merchantId: create.merchantId,
      code: create.code,
      discountType: create.discountType,
      discountValue: create.discountValue,
      minCartTotal: create.minCartTotal,
      maxUsages: create.maxUsages,
      maxPerBuyer: create.maxPerBuyer,
      usagesCount: create.usagesCount,
      allowedSkus: create.allowedSkus,
      blockedSkus: create.blockedSkus,
      allowedRegions: create.allowedRegions,
      blockedRegions: create.blockedRegions,
      freeShippingMinCartTotal: create.freeShippingMinCartTotal ?? null,
      minPerBuyer: create.minPerBuyer ?? null,
      status: create.status,
      startsAt: create.startsAt,
      endsAt: create.endsAt,
      createdAt: new Date(snap.created_at),
      updatedAt: new Date(snap.updated_at)
    });

    assert.equal(rehydrated.id, snap.id);
    assert.equal(rehydrated.merchant_id, snap.merchant_id);
    assert.equal(rehydrated.code, snap.code);
    assert.equal(rehydrated.snapshot().discount_value, snap.discount_value);
    assert.equal(rehydrated.snapshot().min_cart_total, snap.min_cart_total);
    assert.equal(rehydrated.snapshot().max_usages, snap.max_usages);
    assert.equal(rehydrated.snapshot().max_per_buyer, snap.max_per_buyer);
    assert.deepEqual(rehydrated.snapshot().allowed_skus, snap.allowed_skus);
    assert.deepEqual(rehydrated.snapshot().blocked_skus, snap.blocked_skus);
    assert.deepEqual(rehydrated.snapshot().allowed_regions, snap.allowed_regions);
    assert.deepEqual(rehydrated.snapshot().blocked_regions, snap.blocked_regions);
    assert.equal(rehydrated.snapshot().starts_at, snap.starts_at);
    assert.equal(rehydrated.snapshot().ends_at, snap.ends_at);
  });

  it("toCouponEntity maps nullable fields to null", () => {
    const rehydrated = toCouponEntity({
      id: "coup_1",
      merchantId: "mrc_1",
      code: "SAVE10",
      discountType: "fixed",
      discountValue: 20,
      minCartTotal: null,
      maxUsages: null,
      maxPerBuyer: null,
      usagesCount: 0,
      allowedSkus: [],
      blockedSkus: [],
      allowedRegions: [],
      blockedRegions: [],
      freeShippingMinCartTotal: null,
      minPerBuyer: null,
      status: "active",
      startsAt: new Date(),
      endsAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    const snap = rehydrated.snapshot();
    assert.equal(snap.min_cart_total, null);
    assert.equal(snap.max_usages, null);
    assert.equal(snap.max_per_buyer, null);
    assert.equal(snap.ends_at, null);
  });

  it("toCouponUpdateInput omits immutable fields (id, merchantId, code)", () => {
    const coupon = CouponEntity.create({
      merchant_id: "mrc_1",
      code: "SAVE10",
      discount_type: "percent",
      discount_value: 10,
      min_cart_total: null,
      max_usages: null,
      max_per_buyer: null,
      allowed_skus: [],
      blocked_skus: [],
      allowed_regions: [],
      blocked_regions: [],
      starts_at: new Date().toISOString(),
      ends_at: null
    });
    const update = toCouponUpdateInput(coupon);
    const keys = Object.keys(update).sort();
    // Should NOT include identity fields — they're keyed in the upsert where clause
    assert.ok(!keys.includes("id"));
    assert.ok(!keys.includes("merchantId"));
    assert.ok(!keys.includes("code"));
    assert.ok(keys.includes("discountType"));
    assert.ok(keys.includes("discountValue"));
    assert.ok(keys.includes("status"));
  });

  it("toRedemptionCreateInput maps nullable buyer_global_user_id and order_id", () => {
    const r = CouponRedemptionEntity.create({
      coupon_id: "coup_1",
      merchant_id: "mrc_1",
      session_id: "sess_1",
      buyer_global_user_id: null,
      discount_applied: 5,
      source: "auto"
    });
    const create = toRedemptionCreateInput(r);
    assert.equal(create.buyerGlobalUserId, null);
    assert.equal(create.orderId, null);
    assert.equal(create.source, "auto");
  });

  it("toCouponRedemptionEntity / toRedemptionCreateInput round-trip preserves all fields", () => {
    const r = CouponRedemptionEntity.create({
      coupon_id: "coup_1",
      merchant_id: "mrc_1",
      session_id: "sess_1",
      buyer_global_user_id: "usr_1",
      discount_applied: 12.5,
      source: "manual"
    }).redeem("ord_1");

    const create = toRedemptionCreateInput(r);
    const rehydrated = toCouponRedemptionEntity({
      id: create.id,
      couponId: create.couponId,
      merchantId: create.merchantId,
      sessionId: create.sessionId,
      buyerGlobalUserId: create.buyerGlobalUserId,
      discountApplied: create.discountApplied,
      source: create.source,
      status: create.status,
      orderId: create.orderId,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const snap = rehydrated.snapshot();
    assert.equal(snap.id, r.snapshot().id);
    assert.equal(snap.status, "redeemed");
    assert.equal(snap.order_id, "ord_1");
    assert.equal(snap.buyer_global_user_id, "usr_1");
    assert.equal(snap.discount_applied, 12.5);
  });

  it("toRedemptionUpdateInput only contains status and order_id", () => {
    const r = CouponRedemptionEntity.create({
      coupon_id: "coup_1",
      merchant_id: "mrc_1",
      session_id: "sess_1",
      buyer_global_user_id: null,
      discount_applied: 5,
      source: "manual"
    }).redeem("ord_1");
    const update = toRedemptionUpdateInput(r);
    assert.deepEqual(Object.keys(update).sort(), ["orderId", "status"]);
    assert.equal(update.status, "redeemed");
    assert.equal(update.orderId, "ord_1");
  });
});
