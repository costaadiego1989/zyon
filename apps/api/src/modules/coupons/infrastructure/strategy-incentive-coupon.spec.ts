import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma, StrategyIncentiveExecution } from "@prisma/client";
import { digest } from "../../experiments/domain/services/measurement-plan.js";
import { publishStrategyIncentiveCoupon, strategyIncentiveCouponTerms } from "./strategy-incentive-coupon.js";

function execution(kind = "capped_percentage_discount", mode = "coupon_code"): StrategyIncentiveExecution {
  const recommendation = { definition: "weekly-incentive-recommendation-v3", status: "recommended",
    test: { kind, delivery: mode === "automatic" ? { mode } : { mode, code: "ZYON0123456789ABCDEF0123" },
      discountPercent: 10, maxDiscountCents: 500, maxRedemptions: 12,
      ...(kind === "capped_fixed_discount" ? { fixedDiscountCents: 500 } : {}),
      ...(kind === "capped_shipping_discount" ? { shippingDiscountCents: 500 } : {}),
      audience: { minCartTotalCents: 10000 } } };
  return { id: "execution-1", merchantId: "merchant-1", recommendation,
    recommendationHash: digest(recommendation), startedAt: new Date("2026-10-05T03:00:00Z"),
    endsAt: new Date("2026-10-12T03:00:00Z") } as unknown as StrategyIncentiveExecution;
}

test("approved percentage, fixed and shipping codes keep execution scope and immutable use/expiry bounds", () => {
  for (const [kind, discountType, value] of [
    ["capped_percentage_discount", "percent", 10],
    ["capped_fixed_discount", "fixed", 5],
    ["capped_shipping_discount", "shipping_fixed", 5],
  ] as const) {
    const row = execution(kind);
    const terms = strategyIncentiveCouponTerms(row)!;
    assert.equal(terms.strategyIncentiveExecutionId, row.id);
    assert.equal(terms.merchantId, row.merchantId);
    assert.equal(terms.discountType, discountType);
    assert.equal(terms.discountValue, value);
    assert.equal(terms.maxPerBuyer, 1);
    assert.equal(terms.maxUsages, 12);
    assert.equal(terms.minCartTotal, 100);
    assert.deepEqual(terms.endsAt, row.endsAt);
  }
  assert.equal(strategyIncentiveCouponTerms(execution("capped_percentage_discount", "automatic")), null);
});

test("tampered financial terms and invalid code/benefit cannot be published", () => {
  const tampered = execution();
  (tampered.recommendation as any).test.maxDiscountCents = 600;
  assert.throws(() => strategyIncentiveCouponTerms(tampered), /INCENTIVE_EXECUTION_CORRUPT/);
  for (const changes of [{ delivery: { mode: "coupon_code", code: "GLOBAL10" } },
    { maxRedemptions: 0 }, { maxDiscountCents: 0 }, { kind: "unlimited_free_shipping" }]) {
    const row = execution();
    Object.assign((row.recommendation as any).test, changes);
    row.recommendationHash = digest(row.recommendation);
    assert.throws(() => strategyIncentiveCouponTerms(row), /INCENTIVE_COUPON_TERMS_INVALID/);
  }
  const fixed = execution("capped_fixed_discount");
  (fixed.recommendation as any).test.fixedDiscountCents = 600;
  fixed.recommendationHash = digest(fixed.recommendation);
  assert.throws(() => strategyIncentiveCouponTerms(fixed), /INCENTIVE_COUPON_TERMS_INVALID/);
});

test("publication retries return the original code without creating another grant or coupon", async () => {
  const row = execution();
  let saved: any = null;
  let creates = 0;
  const tx = { coupon: {
    findUnique: async () => saved,
    create: async ({ data }: any) => { creates++; saved = data; return data; },
  } } as unknown as Prisma.TransactionClient;
  const first = await publishStrategyIncentiveCoupon(tx, row);
  assert.equal(await publishStrategyIncentiveCoupon(tx, row), first);
  assert.equal(creates, 1);
  assert.equal(saved.status, "active");
  saved.maxUsages++;
  await assert.rejects(publishStrategyIncentiveCoupon(tx, row), /INCENTIVE_COUPON_TERMS_CHANGED/);
  assert.equal(creates, 1);
});

test("a conflicting merchant code fails publication without replacing the existing coupon", async () => {
  const tx = { coupon: { findUnique: async () => null,
    create: async () => { throw new Error("coupon_code_unique_conflict"); } } } as unknown as Prisma.TransactionClient;
  await assert.rejects(publishStrategyIncentiveCoupon(tx, execution()), /coupon_code_unique_conflict/);
});
