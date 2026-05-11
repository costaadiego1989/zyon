import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ApplyCouponUseCase } from "./apply-coupon.use-case.js";
import { CouponEntity } from "../../domain/entities/coupon.entity.js";
import { InMemoryCouponRepository } from "../../infrastructure/repositories/in-memory-coupon.repository.js";
import { InMemoryCouponRedemptionRepository } from "../../infrastructure/repositories/in-memory-coupon-redemption.repository.js";
import { InMemoryOutboxRepository } from "../../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";
import type { Cart } from "@aacp/shared-types";

function makeSetup() {
  const couponRepo = new InMemoryCouponRepository();
  const redemptionRepo = new InMemoryCouponRedemptionRepository();
  const outbox = new InMemoryOutboxRepository();
  const useCase = new ApplyCouponUseCase(couponRepo, redemptionRepo, outbox);
  return { couponRepo, redemptionRepo, outbox, useCase };
}

function makeCouponInput(overrides: Partial<{
  max_usages: number | null;
  max_per_buyer: number | null;
  status: "active" | "archived" | "expired";
}> = {}) {
  return {
    merchant_id: "mrc_1",
    code: "SAVE10",
    discount_type: "percent" as const,
    discount_value: 10,
    min_cart_total: null,
    max_usages: overrides.max_usages ?? null,
    max_per_buyer: overrides.max_per_buyer ?? null,
    allowed_skus: [],
    blocked_skus: [],
    allowed_regions: [],
    blocked_regions: [],
    starts_at: new Date(Date.now() - 1000).toISOString(),
    ends_at: null,
  };
}

const BASE_CART: Cart = {
  items: [{ sku: "SKU-A", price: 100, quantity: 1, name: "Item A" }],
  total: 100,
  currency: "BRL",
};

const BASE_INPUT = {
  merchant_id: "mrc_1",
  session_id: "sess_1",
  code: "SAVE10",
  cart: BASE_CART,
};

describe("ApplyCouponUseCase", () => {
  it("applies coupon and fires outbox event", async () => {
    const { couponRepo, outbox, useCase } = makeSetup();
    await couponRepo.save(CouponEntity.create(makeCouponInput()));

    await useCase.execute(BASE_INPUT);

    const events = outbox.listOutbox("mrc_1");
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, "coupon.applied");
    const payload = events[0].payload as Record<string, unknown>;
    assert.equal(payload.session_id, "sess_1");
    assert.equal(payload.code, "SAVE10");
  });

  it("throws NotFoundException when coupon code not found", async () => {
    const { useCase } = makeSetup();
    await assert.rejects(() => useCase.execute(BASE_INPUT), { message: "COUPON_NOT_FOUND" });
  });

  it("throws BadRequestException when coupon is archived", async () => {
    const { couponRepo, useCase } = makeSetup();
    const coupon = CouponEntity.create(makeCouponInput()).archive();
    await couponRepo.save(coupon);

    await assert.rejects(() => useCase.execute(BASE_INPUT), { message: "COUPON_INVALID" });
  });

  it("throws ConflictException when coupon already applied in same session", async () => {
    const { couponRepo, useCase } = makeSetup();
    await couponRepo.save(CouponEntity.create(makeCouponInput()));

    await useCase.execute(BASE_INPUT);

    await assert.rejects(
      () => useCase.execute(BASE_INPUT),
      { message: "COUPON_ALREADY_APPLIED" }
    );
  });

  it("throws BadRequestException when per-buyer limit is reached", async () => {
    const { couponRepo, useCase } = makeSetup();
    await couponRepo.save(CouponEntity.create(makeCouponInput({ max_per_buyer: 1 })));

    await useCase.execute({ ...BASE_INPUT, buyer_global_user_id: "usr_1" });

    await assert.rejects(
      () => useCase.execute({ ...BASE_INPUT, session_id: "sess_2", buyer_global_user_id: "usr_1" }),
      { message: "COUPON_PER_BUYER_LIMIT_REACHED" }
    );
  });
});
