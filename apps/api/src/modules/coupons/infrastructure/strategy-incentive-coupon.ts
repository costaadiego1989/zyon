import { randomUUID } from "node:crypto";
import type { Prisma, StrategyIncentiveExecution } from "@prisma/client";
import { digest } from "../../experiments/domain/services/measurement-plan.js";
import type { StrategyIncentiveRecommendation } from "../../revenue-manager/domain/strategy-incentive-recommendation.js";

/** The row makes an approved code discoverable; it never grants authority to
 * the ordinary coupon redemption path. All grants use the incentive ledger. */
export function strategyIncentiveCouponTerms(execution: StrategyIncentiveExecution) {
  const recommendation = execution.recommendation as unknown as StrategyIncentiveRecommendation;
  if (recommendation.status !== "recommended" || recommendation.definition !== "weekly-incentive-recommendation-v3") return null;
  if (digest(recommendation) !== execution.recommendationHash) throw new Error("INCENTIVE_EXECUTION_CORRUPT");
  const { test } = recommendation;
  const delivery = test.delivery;
  if (!delivery) throw new Error("INCENTIVE_COUPON_TERMS_INVALID");
  if (delivery.mode !== "coupon_code") return null;
  if (!/^ZYON[A-F0-9]{20}$/.test(delivery.code)
    || !["capped_percentage_discount", "capped_fixed_discount", "capped_shipping_discount"].includes(test.kind)
    || !Number.isSafeInteger(test.maxDiscountCents) || test.maxDiscountCents <= 0
    || (test.kind === "capped_fixed_discount" && test.fixedDiscountCents !== test.maxDiscountCents)
    || (test.kind === "capped_shipping_discount" && test.shippingDiscountCents !== test.maxDiscountCents)
    || !Number.isSafeInteger(test.maxRedemptions) || test.maxRedemptions <= 0
    || !Number.isSafeInteger(test.audience.minCartTotalCents) || test.audience.minCartTotalCents < 0
    || !Number.isFinite(execution.startedAt.getTime()) || !Number.isFinite(execution.endsAt.getTime())
    || execution.endsAt <= execution.startedAt) throw new Error("INCENTIVE_COUPON_TERMS_INVALID");
  const discountType = test.kind === "capped_percentage_discount" ? "percent"
    : test.kind === "capped_fixed_discount" ? "fixed" : "shipping_fixed";
  const discountValue = discountType === "percent" ? test.discountPercent : test.maxDiscountCents / 100;
  if (!Number.isFinite(discountValue) || discountValue <= 0 || (discountType === "percent" && discountValue > 100)) {
    throw new Error("INCENTIVE_COUPON_TERMS_INVALID");
  }
  return {
    merchantId: execution.merchantId, strategyIncentiveExecutionId: execution.id,
    code: delivery.code, discountType, discountValue,
    minCartTotal: test.audience.minCartTotalCents / 100,
    maxUsages: test.maxRedemptions, maxPerBuyer: 1,
    startsAt: execution.startedAt, endsAt: execution.endsAt,
  };
}

/** Must share the approval transaction and merchant lock with execution creation.
 * Code collision fails the transaction, without silently replacing another code. */
export async function publishStrategyIncentiveCoupon(tx: Prisma.TransactionClient, execution: StrategyIncentiveExecution) {
  const terms = strategyIncentiveCouponTerms(execution);
  if (!terms) return null;
  const existing = await tx.coupon.findUnique({ where: { strategyIncentiveExecutionId: execution.id } });
  if (existing) {
    if (existing.merchantId !== terms.merchantId || existing.code !== terms.code
      || existing.discountType !== terms.discountType || Number(existing.discountValue) !== terms.discountValue
      || Number(existing.minCartTotal) !== terms.minCartTotal || existing.maxUsages !== terms.maxUsages
      || existing.maxPerBuyer !== terms.maxPerBuyer || +existing.startsAt !== +terms.startsAt
      || !existing.endsAt || +existing.endsAt !== +terms.endsAt) throw new Error("INCENTIVE_COUPON_TERMS_CHANGED");
    return existing;
  }
  return tx.coupon.create({ data: { id: randomUUID(), ...terms, status: "active" } });
}
