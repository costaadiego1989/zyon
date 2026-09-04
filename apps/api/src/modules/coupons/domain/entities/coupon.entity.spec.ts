import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CouponEntity, type CouponSnapshot } from "./coupon.entity.js";

function baseInput(): Omit<CouponSnapshot, "id" | "usages_count" | "status" | "created_at" | "updated_at"> {
  const now = new Date().toISOString();
  return {
    merchant_id: "mrc_1",
    code: "save10",
    discount_type: "percent",
    discount_value: 10,
    min_cart_total: null,
    max_usages: null,
    max_per_buyer: null,
    allowed_skus: [],
    blocked_skus: [],
    allowed_regions: [],
    blocked_regions: [],
    starts_at: now,
    ends_at: null
  };
}

describe("CouponEntity", () => {
  describe("create", () => {
    it("creates an active coupon and uppercases / trims the code", () => {
      const coupon = CouponEntity.create({ ...baseInput(), code: "  save10  " });
      const snap = coupon.snapshot();
      assert.equal(snap.code, "SAVE10");
      assert.equal(snap.status, "active");
      assert.equal(snap.usages_count, 0);
      assert.ok(snap.id.length > 0);
      assert.ok(snap.created_at.length > 0);
      assert.equal(snap.created_at, snap.updated_at);
    });

    it("rejects empty merchant_id", () => {
      assert.throws(() => CouponEntity.create({ ...baseInput(), merchant_id: "   " }), /coupon_merchant_required/);
    });

    it("rejects empty code", () => {
      assert.throws(() => CouponEntity.create({ ...baseInput(), code: "   " }), /coupon_code_required/);
    });

    it("rejects non-positive discount_value", () => {
      assert.throws(() => CouponEntity.create({ ...baseInput(), discount_value: 0 }), /coupon_discount_value_invalid/);
      assert.throws(() => CouponEntity.create({ ...baseInput(), discount_value: -5 }), /coupon_discount_value_invalid/);
    });

    it("accepts a fixed discount type", () => {
      const coupon = CouponEntity.create({ ...baseInput(), discount_type: "fixed", discount_value: 25 });
      assert.equal(coupon.snapshot().discount_type, "fixed");
      assert.equal(coupon.snapshot().discount_value, 25);
    });
  });

  describe("rehydrate", () => {
    it("rebuilds an entity from a snapshot without mutating it", () => {
      const snap: CouponSnapshot = {
        id: "coup_x",
        merchant_id: "mrc_1",
        code: "BACK10",
        discount_type: "percent",
        discount_value: 10,
        min_cart_total: 50,
        max_usages: 10,
        max_per_buyer: 2,
        usages_count: 3,
        allowed_skus: [],
        blocked_skus: [],
        allowed_regions: [],
        blocked_regions: [],
        status: "active",
        starts_at: new Date(Date.now() - 1000).toISOString(),
        ends_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const coupon = CouponEntity.rehydrate(snap);
      assert.deepEqual(coupon.snapshot(), snap);
    });
  });

  describe("incrementUsage", () => {
    it("returns a new entity with usages_count incremented and updated_at refreshed", () => {
      const coupon = CouponEntity.create(baseInput());
      const originalUpdated = coupon.snapshot().updated_at;
      const next = coupon.incrementUsage();
      assert.equal(next.snapshot().usages_count, 1);
      assert.equal(coupon.snapshot().usages_count, 0);
      assert.ok(next.snapshot().updated_at >= originalUpdated);
    });

    it("supports repeated increments (idempotent count behavior)", () => {
      const coupon = CouponEntity.create(baseInput()).incrementUsage().incrementUsage().incrementUsage();
      assert.equal(coupon.snapshot().usages_count, 3);
    });
  });

  describe("archive", () => {
    it("returns a new entity with status='archived' and refreshed updated_at", () => {
      const coupon = CouponEntity.create(baseInput());
      const archived = coupon.archive();
      assert.equal(archived.snapshot().status, "archived");
      assert.equal(coupon.snapshot().status, "active");
    });
  });

  describe("update", () => {
    it("patches only the listed fields and refreshes updated_at", () => {
      const coupon = CouponEntity.create({ ...baseInput(), discount_value: 10 });
      const originalId = coupon.snapshot().id;
      const originalCode = coupon.snapshot().code;
      const updated = coupon.update({
        discount_value: 20,
        min_cart_total: 100,
        max_usages: 50,
        max_per_buyer: 3,
        allowed_skus: ["SKU-A"],
        blocked_skus: [],
        allowed_regions: ["SP"],
        blocked_regions: [],
        starts_at: new Date(Date.now() - 2000).toISOString(),
        ends_at: new Date(Date.now() + 86_400_000).toISOString()
      });
      const snap = updated.snapshot();
      assert.equal(snap.id, originalId);
      assert.equal(snap.code, originalCode);
      assert.equal(snap.discount_value, 20);
      assert.equal(snap.min_cart_total, 100);
      assert.equal(snap.max_usages, 50);
      assert.equal(snap.max_per_buyer, 3);
      assert.deepEqual(snap.allowed_skus, ["SKU-A"]);
      assert.deepEqual(snap.allowed_regions, ["SP"]);
    });
  });

  describe("getters", () => {
    it("exposes identity-bearing fields", () => {
      const coupon = CouponEntity.create(baseInput());
      assert.equal(coupon.id, coupon.snapshot().id);
      assert.equal(coupon.merchant_id, "mrc_1");
      assert.equal(coupon.code, "SAVE10");
      assert.equal(coupon.status, "active");
    });
  });
});
