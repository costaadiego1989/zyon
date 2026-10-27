import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ArchiveCouponUseCase } from "./archive-coupon.use-case.js";
import { CouponEntity } from "../../domain/entities/coupon.entity.js";
import { CouponRedemptionEntity } from "../../domain/entities/coupon-redemption.entity.js";
import { InMemoryCouponRepository } from "../../infrastructure/repositories/in-memory-coupon.repository.js";
import { InMemoryCouponRedemptionRepository } from "../../infrastructure/repositories/in-memory-coupon-redemption.repository.js";

function makeCouponRepo() {
  return new InMemoryCouponRepository();
}
function makeRedemptionRepo() {
  return new InMemoryCouponRedemptionRepository();
}

async function saveCoupon(repo: InMemoryCouponRepository, merchantId: string, code: string) {
  const c = CouponEntity.create({
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
    starts_at: new Date().toISOString(),
    ends_at: null
  });
  await repo.save(c);
  return c;
}

describe("ArchiveCouponUseCase", () => {
  it("archives a coupon with no redemptions", async () => {
    const couponRepo = makeCouponRepo();
    const redemptionRepo = makeRedemptionRepo();
    const useCase = new ArchiveCouponUseCase(couponRepo, redemptionRepo);
    const coupon = await saveCoupon(couponRepo, "mrc_1", "SAVE10");

    const result = await useCase.execute({ id: coupon.id, merchant_id: "mrc_1" });
    assert.equal(result.status, "archived");
    assert.equal(result.id, coupon.id);

    const found = await couponRepo.findById(coupon.id, "mrc_1");
    assert.equal(found?.status, "archived");
  });

  it("throws NotFoundException when coupon does not exist", async () => {
    const couponRepo = makeCouponRepo();
    const redemptionRepo = makeRedemptionRepo();
    const useCase = new ArchiveCouponUseCase(couponRepo, redemptionRepo);

    await assert.rejects(
      () => useCase.execute({ id: "missing", merchant_id: "mrc_1" }),
      { message: "coupon_not_found" }
    );
  });

  it("throws NotFoundException when couponId belongs to a different merchant (tenant boundary)", async () => {
    const couponRepo = makeCouponRepo();
    const redemptionRepo = makeRedemptionRepo();
    const useCase = new ArchiveCouponUseCase(couponRepo, redemptionRepo);
    const coupon = await saveCoupon(couponRepo, "mrc_1", "SAVE10");

    await assert.rejects(
      () => useCase.execute({ id: coupon.id, merchant_id: "mrc_OTHER" }),
      { message: "coupon_not_found" }
    );
  });

  it("blocks archive when there is an applied redemption in flight", async () => {
    const couponRepo = makeCouponRepo();
    const redemptionRepo = makeRedemptionRepo();
    const useCase = new ArchiveCouponUseCase(couponRepo, redemptionRepo);
    const coupon = await saveCoupon(couponRepo, "mrc_1", "SAVE10");

    await redemptionRepo.save(CouponRedemptionEntity.create({
      coupon_id: coupon.id,
      merchant_id: "mrc_1",
      session_id: "sess_1",
      buyer_global_user_id: null,
      discount_applied: 10,
      source: "manual"
    }));

    await assert.rejects(
      () => useCase.execute({ id: coupon.id, merchant_id: "mrc_1" }),
      { message: "coupon_has_active_redemptions" }
    );

    // Status must remain active after failed archive
    const found = await couponRepo.findById(coupon.id, "mrc_1");
    assert.equal(found?.status, "active");
  });

  it("blocks archive when only redeemed redemptions exist (H4: countByCoupon counts non-cancelled)", async () => {
    const couponRepo = makeCouponRepo();
    const redemptionRepo = makeRedemptionRepo();
    const useCase = new ArchiveCouponUseCase(couponRepo, redemptionRepo);
    const coupon = await saveCoupon(couponRepo, "mrc_1", "SAVE10");

    const redemption = CouponRedemptionEntity.create({
      coupon_id: coupon.id,
      merchant_id: "mrc_1",
      session_id: "sess_1",
      buyer_global_user_id: null,
      discount_applied: 10,
      source: "manual"
    }).redeem("ord_1");
    await redemptionRepo.save(redemption);

    // countByCoupon counts applied + redeemed → archive is blocked
    await assert.rejects(
      () => useCase.execute({ id: coupon.id, merchant_id: "mrc_1" }),
      { message: "coupon_has_active_redemptions" }
    );
  });

  it("allows archive when only cancelled redemptions exist", async () => {
    const couponRepo = makeCouponRepo();
    const redemptionRepo = makeRedemptionRepo();
    const useCase = new ArchiveCouponUseCase(couponRepo, redemptionRepo);
    const coupon = await saveCoupon(couponRepo, "mrc_1", "SAVE10");

    const redemption = CouponRedemptionEntity.create({
      coupon_id: coupon.id,
      merchant_id: "mrc_1",
      session_id: "sess_1",
      buyer_global_user_id: null,
      discount_applied: 10,
      source: "manual"
    }).cancel();
    await redemptionRepo.save(redemption);

    const result = await useCase.execute({ id: coupon.id, merchant_id: "mrc_1" });
    assert.equal(result.status, "archived");
  });

  it("archive is idempotent at the use-case level (already archived succeeds)", async () => {
    const couponRepo = makeCouponRepo();
    const redemptionRepo = makeRedemptionRepo();
    const useCase = new ArchiveCouponUseCase(couponRepo, redemptionRepo);
    const active = await saveCoupon(couponRepo, "mrc_1", "SAVE10");
    const archived = active.archive();
    await couponRepo.save(archived);

    const result = await useCase.execute({ id: archived.id, merchant_id: "mrc_1" });
    assert.equal(result.status, "archived");
  });
});