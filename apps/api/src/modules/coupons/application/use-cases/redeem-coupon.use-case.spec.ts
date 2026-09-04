import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RedeemCouponUseCase } from "./redeem-coupon.use-case.js";
import { CouponEntity } from "../../domain/entities/coupon.entity.js";
import { CouponRedemptionEntity } from "../../domain/entities/coupon-redemption.entity.js";
import { InMemoryCouponRepository } from "../../infrastructure/repositories/in-memory-coupon.repository.js";
import { InMemoryCouponRedemptionRepository } from "../../infrastructure/repositories/in-memory-coupon-redemption.repository.js";
import { InMemoryOutboxRepository } from "../../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";

function makeCoupon(merchantId: string, code: string) {
  return CouponEntity.create({
    merchant_id: merchantId,
    code,
    discount_type: "percent",
    discount_value: 10,
    min_cart_total: null,
    max_usages: null,
    max_per_buyer: null,
    allowed_skus: [],
    blocked_skus: [],
    allowed_regions: [],
    blocked_regions: [],
    starts_at: new Date(Date.now() - 1000).toISOString(),
    ends_at: null
  });
}

function makeRedemption(couponId: string, merchantId: string, sessionId: string) {
  return CouponRedemptionEntity.create({
    coupon_id: couponId,
    merchant_id: merchantId,
    session_id: sessionId,
    buyer_global_user_id: "usr_1",
    discount_applied: 10,
    source: "manual"
  });
}

function makeSetup() {
  const coupons = new InMemoryCouponRepository();
  const redemptions = new InMemoryCouponRedemptionRepository();
  const outbox = new InMemoryOutboxRepository();
  const useCase = new RedeemCouponUseCase(coupons, redemptions, outbox);
  return { coupons, redemptions, outbox, useCase };
}

describe("RedeemCouponUseCase", () => {
  it("transitions applied redemptions to redeemed and increments coupon usage", async () => {
    const { coupons, redemptions, outbox, useCase } = makeSetup();
    const coupon = makeCoupon("mrc_1", "SAVE10");
    await coupons.save(coupon);
    await redemptions.save(makeRedemption(coupon.id, "mrc_1", "sess_1"));

    await useCase.execute({ session_id: "sess_1", merchant_id: "mrc_1", order_id: "ord_1" });

    const stored = (await redemptions.findBySession("sess_1", "mrc_1"))[0];
    assert.equal(stored?.status, "redeemed");
    assert.equal(stored?.snapshot().order_id, "ord_1");

    const updatedCoupon = await coupons.findById(coupon.id, "mrc_1");
    assert.equal(updatedCoupon?.snapshot().usages_count, 1);

    const events = outbox.listOutbox("mrc_1");
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, "coupon.redeemed");
    const payload = events[0].payload as Record<string, unknown>;
    assert.equal(payload.session_id, "sess_1");
    assert.equal(payload.order_id, "ord_1");
    assert.equal(payload.discount_applied, 10);
  });

  it("redeems multiple applied redemptions in the same session", async () => {
    const { coupons, redemptions, outbox, useCase } = makeSetup();
    const c1 = makeCoupon("mrc_1", "CODE1");
    const c2 = makeCoupon("mrc_1", "CODE2");
    await coupons.save(c1);
    await coupons.save(c2);
    await redemptions.save(makeRedemption(c1.id, "mrc_1", "sess_1"));
    await redemptions.save(makeRedemption(c2.id, "mrc_1", "sess_1"));

    await useCase.execute({ session_id: "sess_1", merchant_id: "mrc_1", order_id: "ord_1" });

    const all = await redemptions.findBySession("sess_1", "mrc_1");
    assert.ok(all.every((r) => r.status === "redeemed"));
    const events = outbox.listOutbox("mrc_1");
    assert.equal(events.length, 2);
  });

  it("skips already redeemed and cancelled redemptions (only processes applied)", async () => {
    const { coupons, redemptions, outbox, useCase } = makeSetup();
    const coupon = makeCoupon("mrc_1", "SAVE10");
    await coupons.save(coupon);

    // Create a redeemed one
    const redeemed = makeRedemption(coupon.id, "mrc_1", "sess_1").redeem("ord_0");
    await redemptions.save(redeemed);
    // Create a cancelled one
    const cancelled = makeRedemption(coupon.id, "mrc_1", "sess_1").cancel();
    await redemptions.save(cancelled);

    await useCase.execute({ session_id: "sess_1", merchant_id: "mrc_1", order_id: "ord_1" });

    // No new events should be emitted
    const events = outbox.listOutbox("mrc_1");
    assert.equal(events.length, 0);
  });

  it("does nothing when no redemptions exist for the session", async () => {
    const { outbox, useCase } = makeSetup();

    await useCase.execute({ session_id: "sess_none", merchant_id: "mrc_1", order_id: "ord_1" });

    assert.equal(outbox.listOutbox("mrc_1").length, 0);
  });

  it("is merchant-scoped: does not redeem another tenant's redemptions", async () => {
    const { coupons, redemptions, outbox, useCase } = makeSetup();
    const coupon = makeCoupon("mrc_1", "SAVE10");
    await coupons.save(coupon);
    await redemptions.save(makeRedemption(coupon.id, "mrc_1", "sess_1"));

    // Call with a different merchant
    await useCase.execute({ session_id: "sess_1", merchant_id: "mrc_OTHER", order_id: "ord_1" });

    // Original redemption remains applied
    const stored = (await redemptions.findBySession("sess_1", "mrc_1"))[0];
    assert.equal(stored?.status, "applied");
    assert.equal(outbox.listOutbox("mrc_OTHER").length, 0);
  });
});