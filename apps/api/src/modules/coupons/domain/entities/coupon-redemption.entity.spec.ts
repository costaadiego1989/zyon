import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CouponRedemptionEntity, type CouponRedemptionSnapshot } from "./coupon-redemption.entity.js";

function baseInput() {
  return {
    coupon_id: "coup_1",
    merchant_id: "mrc_1",
    session_id: "sess_1",
    buyer_global_user_id: "usr_1",
    discount_applied: 10,
    source: "manual" as const
  };
}

describe("CouponRedemptionEntity", () => {
  describe("create", () => {
    it("creates an 'applied' redemption with null order_id and generated id/timestamps", () => {
      const r = CouponRedemptionEntity.create(baseInput());
      const snap = r.snapshot();
      assert.equal(snap.status, "applied");
      assert.equal(snap.order_id, null);
      assert.ok(snap.id.length > 0);
      assert.equal(snap.created_at, snap.updated_at);
      assert.equal(snap.discount_applied, 10);
      assert.equal(snap.source, "manual");
    });

    it("accepts auto source", () => {
      const r = CouponRedemptionEntity.create({ ...baseInput(), source: "auto" });
      assert.equal(r.snapshot().source, "auto");
    });
  });

  describe("rehydrate", () => {
    it("rebuilds an entity from a snapshot", () => {
      const snap: CouponRedemptionSnapshot = {
        id: "red_1",
        coupon_id: "coup_1",
        merchant_id: "mrc_1",
        session_id: "sess_1",
        buyer_global_user_id: "usr_1",
        discount_applied: 10,
        source: "manual",
        status: "redeemed",
        order_id: "ord_1",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const r = CouponRedemptionEntity.rehydrate(snap);
      assert.deepEqual(r.snapshot(), snap);
    });
  });

  describe("redeem", () => {
    it("transitions applied → redeemed with order_id", () => {
      const r = CouponRedemptionEntity.create(baseInput()).redeem("ord_1");
      const snap = r.snapshot();
      assert.equal(snap.status, "redeemed");
      assert.equal(snap.order_id, "ord_1");
    });

    it("throws illegal_transition if called from redeemed status", () => {
      const r = CouponRedemptionEntity.create(baseInput()).redeem("ord_1");
      assert.throws(() => r.redeem("ord_2"), /illegal_transition/);
    });

    it("throws illegal_transition if called from cancelled status", () => {
      const r = CouponRedemptionEntity.create(baseInput()).cancel();
      assert.throws(() => r.redeem("ord_1"), /illegal_transition/);
    });
  });

  describe("cancel", () => {
    it("transitions applied → cancelled", () => {
      const r = CouponRedemptionEntity.create(baseInput()).cancel();
      assert.equal(r.snapshot().status, "cancelled");
    });

    it("throws illegal_transition if called from non-applied state", () => {
      const r = CouponRedemptionEntity.create(baseInput()).redeem("ord_1");
      assert.throws(() => r.cancel(), /illegal_transition/);
    });
  });

  describe("getters", () => {
    it("exposes identity-bearing fields", () => {
      const r = CouponRedemptionEntity.create(baseInput());
      assert.equal(r.id, r.snapshot().id);
      assert.equal(r.coupon_id, "coup_1");
      assert.equal(r.session_id, "sess_1");
      assert.equal(r.merchant_id, "mrc_1");
      assert.equal(r.status, "applied");
    });
  });
});
