import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CouponRedemptionEntity } from "../../domain/entities/coupon-redemption.entity.js";
import { InMemoryCouponRedemptionRepository } from "./in-memory-coupon-redemption.repository.js";

function makeRedemption(overrides: Partial<{
  coupon_id: string;
  merchant_id: string;
  session_id: string;
  buyer_global_user_id: string | null;
  discount_applied: number;
  source: "manual" | "auto";
}> = {}) {
  return CouponRedemptionEntity.create({
    coupon_id: overrides.coupon_id ?? "coup_1",
    merchant_id: overrides.merchant_id ?? "mrc_1",
    session_id: overrides.session_id ?? "sess_1",
    buyer_global_user_id: overrides.buyer_global_user_id ?? null,
    discount_applied: overrides.discount_applied ?? 10,
    source: overrides.source ?? "manual"
  });
}

describe("InMemoryCouponRedemptionRepository", () => {
  it("save + findById scoped by merchantId", async () => {
    const repo = new InMemoryCouponRedemptionRepository();
    const r = makeRedemption();
    await repo.save(r);

    const found = await repo.findById(r.id, "mrc_1");
    assert.ok(found);
    const leaked = await repo.findById(r.id, "mrc_OTHER");
    assert.equal(leaked, null);
  });

  it("findBySession returns all redemptions for a session, scoped by merchantId", async () => {
    const repo = new InMemoryCouponRedemptionRepository();
    await repo.save(makeRedemption({ session_id: "sess_1", coupon_id: "coup_1" }));
    await repo.save(makeRedemption({ session_id: "sess_1", coupon_id: "coup_2" }));
    await repo.save(makeRedemption({ session_id: "sess_2" }));
    await repo.save(makeRedemption({ session_id: "sess_1", merchant_id: "mrc_OTHER" }));

    const sameSession = await repo.findBySession("sess_1", "mrc_1");
    assert.equal(sameSession.length, 2);

    const otherTenant = await repo.findBySession("sess_1", "mrc_OTHER");
    assert.equal(otherTenant.length, 1);
  });

  it("countByBuyer counts non-cancelled only and matches by buyerGlobalUserId", async () => {
    const repo = new InMemoryCouponRedemptionRepository();
    const a = makeRedemption({ coupon_id: "coup_1", buyer_global_user_id: "usr_A" });
    const b = makeRedemption({ coupon_id: "coup_1", buyer_global_user_id: "usr_B" });
    await repo.save(a);
    await repo.save(b);
    await repo.save(a.cancel()); // cancel a — overwrites the stored entity

    const countA = await repo.countByBuyer("coup_1", "usr_A");
    const countB = await repo.countByBuyer("coup_1", "usr_B");
    assert.equal(countA, 0);
    assert.equal(countB, 1);
  });

  it("countByCoupon counts applied + redeemed (excludes cancelled)", async () => {
    const repo = new InMemoryCouponRedemptionRepository();
    const r1 = makeRedemption({ coupon_id: "coup_1", session_id: "s1" });
    const r2 = makeRedemption({ coupon_id: "coup_1", session_id: "s2" });
    const r3 = makeRedemption({ coupon_id: "coup_1", session_id: "s3" });
    await repo.save(r1); // stays applied
    await repo.save(r2);
    await repo.save(r3);
    await repo.save(r2.cancel());  // cancelled
    await repo.save(r3.redeem("ord_1")); // redeemed

    const count = await repo.countByCoupon("coup_1");
    assert.equal(count, 2, "should count applied (1) + redeemed (1) = 2");
  });

  it("countByCoupon ignores cancelled redemptions across multiple coupons", async () => {
    const repo = new InMemoryCouponRedemptionRepository();
    const a = makeRedemption({ coupon_id: "coup_1" });
    const b = makeRedemption({ coupon_id: "coup_2" });
    await repo.save(a);
    await repo.save(b);
    await repo.save(a.cancel());

    assert.equal(await repo.countByCoupon("coup_1"), 0);
    assert.equal(await repo.countByCoupon("coup_2"), 1);
  });
});
