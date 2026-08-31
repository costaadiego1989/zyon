import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CouponEntity } from "../../domain/entities/coupon.entity.js";
import { InMemoryCouponRepository } from "../../infrastructure/repositories/in-memory-coupon.repository.js";
import { InMemoryCouponRedemptionRepository } from "../../infrastructure/repositories/in-memory-coupon-redemption.repository.js";
import { CreateCouponUseCase } from "../../application/use-cases/create-coupon.use-case.js";
import { ArchiveCouponUseCase } from "../../application/use-cases/archive-coupon.use-case.js";
import { ToggleCouponActiveUseCase } from "../../application/use-cases/toggle-coupon-active.use-case.js";
import { MerchantCouponsController } from "./merchant-coupons.controller.js";

function makeAuthRequest(merchantId: string) {
  return {
    user: { userId: "usr_1", merchantId, email: "admin@test.com", role: "owner" as const }
  };
}

describe("MerchantCouponsController", () => {
  function setup() {
    const couponRepo = new InMemoryCouponRepository();
    const redemptionRepo = new InMemoryCouponRedemptionRepository();
    const createUseCase = new CreateCouponUseCase(couponRepo);
    const archiveUseCase = new ArchiveCouponUseCase(couponRepo, redemptionRepo);
    const toggleUseCase = new ToggleCouponActiveUseCase(couponRepo);
    const controller = new MerchantCouponsController(createUseCase, archiveUseCase, toggleUseCase, couponRepo);
    return { couponRepo, redemptionRepo, createUseCase, archiveUseCase, toggleUseCase, controller };
  }

  it("create derives merchant_id from authenticated user, ignoring body", async () => {
    const { controller, couponRepo } = setup();
    const req = makeAuthRequest("mrc_auth");

    const result = await controller.create(req, {
      code: "PROMO",
      discount_type: "percent",
      discount_value: 15,
      starts_at: new Date().toISOString()
    } as never);

    assert.equal(result.merchant_id, "mrc_auth");
    assert.equal(result.code, "PROMO");
    const found = await couponRepo.findByCode("mrc_auth", "PROMO");
    assert.ok(found);
  });

  it("list returns only coupons for the authenticated merchant", async () => {
    const { controller, couponRepo } = setup();

    // Seed two merchants
    await couponRepo.save(CouponEntity.create({
      merchant_id: "mrc_auth",
      code: "A",
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
    }));
    await couponRepo.save(CouponEntity.create({
      merchant_id: "mrc_other",
      code: "B",
      discount_type: "fixed",
      discount_value: 5,
      min_cart_total: null,
      max_usages: null,
      max_per_buyer: null,
      allowed_skus: [],
      blocked_skus: [],
      allowed_regions: [],
      blocked_regions: [],
      starts_at: new Date().toISOString(),
      ends_at: null
    }));

    const results = await controller.list(makeAuthRequest("mrc_auth"));
    assert.equal(results.length, 1);
    assert.ok(results.every((c) => c.merchant_id === "mrc_auth"));
  });

  it("archive derives merchant_id from auth and archives the coupon", async () => {
    const { controller, couponRepo } = setup();
    const created = await controller.create(makeAuthRequest("mrc_auth"), {
      code: "TEMP",
      discount_type: "percent",
      discount_value: 5,
      starts_at: new Date().toISOString()
    } as never);

    const result = await controller.archive(makeAuthRequest("mrc_auth"), created.id);
    assert.equal(result.status, "archived");

    const found = await couponRepo.findById(created.id, "mrc_auth");
    assert.equal(found?.status, "archived");
  });

  it("archive rejects when merchant_id does not match (tenant boundary)", async () => {
    const { controller, couponRepo } = setup();
    const c = CouponEntity.create({
      merchant_id: "mrc_owner",
      code: "SECRET",
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
    await couponRepo.save(c);

    await assert.rejects(
      () => controller.archive(makeAuthRequest("mrc_attacker"), c.id),
      { message: "coupon_not_found" }
    );
  });
});