import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CouponEntity } from "../../domain/entities/coupon.entity.js";
import { InMemoryCouponRepository } from "./in-memory-coupon.repository.js";

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
    starts_at: new Date().toISOString(),
    ends_at: null
  });
}

describe("InMemoryCouponRepository", () => {
  it("saves and finds by id scoped to merchant", async () => {
    const repo = new InMemoryCouponRepository();
    const c = makeCoupon("mrc_1", "SAVE10");
    await repo.save(c);

    const found = await repo.findById(c.id, "mrc_1");
    assert.ok(found);
    assert.equal(found?.id, c.id);
  });

  it("findById returns null when merchantId mismatches", async () => {
    const repo = new InMemoryCouponRepository();
    const c = makeCoupon("mrc_1", "SAVE10");
    await repo.save(c);
    const found = await repo.findById(c.id, "mrc_OTHER");
    assert.equal(found, null);
  });

  it("findByCode matches case-insensitively and uppercases stored codes", async () => {
    const repo = new InMemoryCouponRepository();
    await repo.save(makeCoupon("mrc_1", "save10"));

    const found = await repo.findByCode("mrc_1", "SAVE10");
    assert.ok(found);
    assert.equal(found?.code, "SAVE10");
  });

  it("findByCode returns null when no match", async () => {
    const repo = new InMemoryCouponRepository();
    const found = await repo.findByCode("mrc_1", "DOESNOTEXIST");
    assert.equal(found, null);
  });

  it("findByCode is merchant-scoped (cross-tenant isolation)", async () => {
    const repo = new InMemoryCouponRepository();
    await repo.save(makeCoupon("mrc_1", "SAVE10"));
    const found = await repo.findByCode("mrc_OTHER", "SAVE10");
    assert.equal(found, null);
  });

  it("findAllByMerchant returns only coupons for the given merchant", async () => {
    const repo = new InMemoryCouponRepository();
    await repo.save(makeCoupon("mrc_1", "A"));
    await repo.save(makeCoupon("mrc_1", "B"));
    await repo.save(makeCoupon("mrc_2", "C"));

    const a = await repo.findAllByMerchant("mrc_1");
    assert.equal(a.length, 2);
    assert.ok(a.every((c) => c.merchant_id === "mrc_1"));

    const b = await repo.findAllByMerchant("mrc_2");
    assert.equal(b.length, 1);
    assert.equal(b[0]?.code, "C");
  });

  it("save overwrites an existing entity (id-keyed)", async () => {
    const repo = new InMemoryCouponRepository();
    const c = makeCoupon("mrc_1", "SAVE10");
    await repo.save(c);
    const archived = c.archive();
    await repo.save(archived);

    const found = await repo.findById(c.id, "mrc_1");
    assert.equal(found?.status, "archived");
  });
});
