import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CreateCouponUseCase, type CreateCouponInput } from "./create-coupon.use-case.js";
import { InMemoryCouponRepository } from "../../infrastructure/repositories/in-memory-coupon.repository.js";

function makeInput(overrides: Partial<CreateCouponInput> = {}): CreateCouponInput {
  return {
    merchant_id: overrides.merchant_id ?? "mrc_1",
    code: overrides.code ?? "SAVE10",
    discount_type: overrides.discount_type ?? "percent",
    discount_value: overrides.discount_value ?? 10,
    starts_at: overrides.starts_at ?? new Date(Date.now() - 1000).toISOString(),
    ...overrides
  };
}

describe("CreateCouponUseCase", () => {
  it("persists a coupon and returns its snapshot", async () => {
    const repo = new InMemoryCouponRepository();
    const useCase = new CreateCouponUseCase(repo);

    const result = await useCase.execute(makeInput({ code: "summer25", discount_value: 25 }));

    assert.equal(result.code, "SUMMER25");
    assert.equal(result.discount_value, 25);
    assert.equal(result.status, "active");
    assert.equal(result.usages_count, 0);

    const found = await repo.findByCode("mrc_1", "SUMMER25");
    assert.ok(found);
    assert.equal(found?.id, result.id);
  });

  it("persists optional limit fields when supplied", async () => {
    const repo = new InMemoryCouponRepository();
    const useCase = new CreateCouponUseCase(repo);

    const result = await useCase.execute(
      makeInput({
        code: "VIP",
        min_cart_total: 200,
        max_usages: 100,
        max_per_buyer: 2,
        allowed_skus: ["SKU-A"],
        blocked_skus: ["SKU-B"],
        allowed_regions: ["SP"],
        blocked_regions: ["RJ"],
        ends_at: new Date(Date.now() + 86_400_000).toISOString()
      })
    );

    assert.equal(result.min_cart_total, 200);
    assert.equal(result.max_usages, 100);
    assert.equal(result.max_per_buyer, 2);
    assert.deepEqual(result.allowed_skus, ["SKU-A"]);
    assert.deepEqual(result.blocked_skus, ["SKU-B"]);
    assert.deepEqual(result.allowed_regions, ["SP"]);
    assert.deepEqual(result.blocked_regions, ["RJ"]);
    assert.ok(result.ends_at);
  });

  it("rejects invalid inputs (empty merchant, empty code, non-positive value)", async () => {
    const repo = new InMemoryCouponRepository();
    const useCase = new CreateCouponUseCase(repo);

    await assert.rejects(
      () => useCase.execute(makeInput({ merchant_id: "" })),
      /coupon_merchant_required/
    );
    await assert.rejects(
      () => useCase.execute(makeInput({ code: "  " })),
      /coupon_code_required/
    );
    await assert.rejects(
      () => useCase.execute(makeInput({ discount_value: 0 })),
      /coupon_discount_value_invalid/
    );
    await assert.rejects(
      () => useCase.execute(makeInput({ discount_value: -1 })),
      /coupon_discount_value_invalid/
    );
  });

  it("allows two coupons with the same code under different merchants", async () => {
    const repo = new InMemoryCouponRepository();
    const useCase = new CreateCouponUseCase(repo);

    await useCase.execute(makeInput({ merchant_id: "mrc_1", code: "WELCOME" }));
    await useCase.execute(makeInput({ merchant_id: "mrc_2", code: "WELCOME" }));

    const a = await repo.findByCode("mrc_1", "WELCOME");
    const b = await repo.findByCode("mrc_2", "WELCOME");
    assert.ok(a);
    assert.ok(b);
    assert.notEqual(a?.id, b?.id);
  });
});