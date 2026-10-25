import assert from "node:assert/strict";
import { test } from "node:test";
import { CouponEntity } from "../../domain/entities/coupon.entity.js";
import { toCouponCreateInput } from "./prisma-coupon.converters.js";
import { PrismaCouponRepository } from "./prisma-coupon.repository.js";

test("listing derives admission status from tenant-scoped budget reads without changing code redemption authority", async () => {
  const now = new Date();
  const endsAt = new Date(+now + 86400000);
  const row = { ...toCouponCreateInput(CouponEntity.create({ merchant_id: "store", code: "ZYON0123456789ABCDEF0123",
    discount_type: "fixed", discount_value: 5, min_cart_total: 100, max_usages: 30, max_per_buyer: 1,
    allowed_skus: [], blocked_skus: [], allowed_regions: [], blocked_regions: [],
    starts_at: now.toISOString(), ends_at: endsAt.toISOString() })),
    createdAt: now, updatedAt: now, strategyIncentiveExecutionId: "execution-1",
    strategyIncentiveExecution: { budgetId: "budget-1", startedAt: now, endsAt } };
  const prisma = {
    coupon: { findMany: async () => [row], findUnique: async () => row },
    strategyIncentiveBudget: { findMany: async (input: any) => {
      assert.deepEqual(input.where, { merchantId: "store", id: { in: ["budget-1"] } });
      return [{ id: "budget-1", closedAt: null, limitCents: 15000, maxDiscountCents: 500, maxRedemptions: 30,
        reservedCount: 30, reservedCents: 15000, spentCount: 0, spentCents: 0 }];
    } },
  };
  const repository = new PrismaCouponRepository(prisma as never);
  const listed = (await repository.findAllByMerchant("store"))[0].snapshot();
  assert.equal(listed.status, "paused");
  assert.equal(listed.strategy_incentive_state, "capacity_reached");
  const forCheckout = await repository.findByCode("store", row.code);
  assert.equal(forCheckout?.status, "active");
  assert.equal(forCheckout?.snapshot().strategy_incentive_state, undefined);
  assert.equal(row.status, "active");
});
