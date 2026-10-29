import assert from "node:assert/strict";
import { test } from "node:test";
import { CouponEntity } from "../entities/coupon.entity.js";
import { presentStrategyCoupon, type StrategyCouponPresentationAuthority } from "./strategy-coupon-presentation.js";

const start = new Date("2026-10-05T03:00:00Z"), end = new Date("2026-10-12T03:00:00Z");
function coupon(strategy = true) {
  return CouponEntity.create({ merchant_id: "store", code: "ZYON0123456789ABCDEF0123", discount_type: "fixed", discount_value: 5,
    min_cart_total: 100, max_usages: 30, max_per_buyer: 1, allowed_skus: [], blocked_skus: [], allowed_regions: [], blocked_regions: [],
    starts_at: start.toISOString(), ends_at: end.toISOString(), ...(strategy ? { strategy_incentive_execution_id: "execution-1" } : {}) });
}
function authority(): StrategyCouponPresentationAuthority {
  return { startedAt: start, endsAt: end, budget: { closedAt: null, limitCents: 15000, maxDiscountCents: 500,
    maxRedemptions: 30, reservedCents: 0, spentCents: 0, reservedCount: 0, spentCount: 0 } };
}

test("a strategy coupon becomes ended exactly at its deadline without a budget or coupon write", () => {
  const saved = coupon(), ledger = authority();
  assert.equal(presentStrategyCoupon(saved, ledger, new Date(+end - 1)).status, "active");
  const ended = presentStrategyCoupon(saved, ledger, end).snapshot();
  assert.equal(ended.status, "expired");
  assert.equal(ended.strategy_incentive_state, "ended");
  assert.equal(saved.status, "active");
  assert.equal(ledger.budget!.closedAt, null);
});

test("fully reserved capacity is unavailable for new buyers while held grants remain unmodified", () => {
  const saved = coupon(), ledger = authority();
  ledger.budget!.reservedCount = 30;
  ledger.budget!.reservedCents = 15000;
  const displayed = presentStrategyCoupon(saved, ledger, start).snapshot();
  assert.equal(displayed.status, "paused");
  assert.equal(displayed.strategy_incentive_state, "capacity_reached");
  assert.equal(displayed.usages_count, 0); // No settled redemption is invented.
  assert.equal(saved.status, "active");
  ledger.budget!.reservedCount--;
  ledger.budget!.reservedCents -= 500;
  assert.equal(presentStrategyCoupon(saved, ledger, start).snapshot().strategy_incentive_state, "active");
});

test("available money must fund a complete grant even when a redemption slot remains", () => {
  const ledger = authority();
  Object.assign(ledger.budget!, { reservedCents: 14900, reservedCount: 29 });
  assert.equal(presentStrategyCoupon(coupon(), ledger, start).snapshot().strategy_incentive_state, "capacity_reached");
});

test("scheduled, stopped and missing authority are explicit, and manual coupon behavior stays intact", () => {
  const saved = coupon(), ledger = authority();
  assert.equal(presentStrategyCoupon(saved, ledger, new Date(+start - 1)).snapshot().strategy_incentive_state, "scheduled");
  assert.equal(presentStrategyCoupon(saved, null, start).snapshot().strategy_incentive_state, "unavailable");
  ledger.budget!.closedAt = start;
  assert.equal(presentStrategyCoupon(saved, ledger, start).snapshot().strategy_incentive_state, "closed");
  const manual = coupon(false);
  assert.equal(presentStrategyCoupon(manual, null, end), manual);
});
