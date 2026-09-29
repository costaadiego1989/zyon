import { digest } from "../../experiments/domain/services/measurement-plan.js";

export type IncentivePolicyLimits = { enabled: boolean; limitCents: number; maxDiscountCents: number; maxRedemptions: number };
export type IncentivePolicySnapshot = IncentivePolicyLimits & { merchantId: string; version: number; policyHash: string };

export function assertIncentivePolicyLimits(value: IncentivePolicyLimits): void {
  if (!value || typeof value.enabled !== "boolean"
    || [value.limitCents, value.maxDiscountCents, value.maxRedemptions].some(n => !Number.isSafeInteger(n) || n < 0)
    || value.limitCents > 2_147_483_647 || value.maxDiscountCents > value.limitCents || value.maxRedemptions > 1_000_000
    || !(value.limitCents > 0 && value.maxDiscountCents > 0 && value.maxRedemptions > 0
      || !value.enabled && value.limitCents === 0 && value.maxDiscountCents === 0 && value.maxRedemptions === 0)) {
    throw new Error("INCENTIVE_POLICY_INVALID_LIMITS");
  }
}

export function incentivePolicySnapshot(merchantId: string, version: number, limits: IncentivePolicyLimits): IncentivePolicySnapshot {
  assertIncentivePolicyLimits(limits);
  if (!merchantId?.trim() || !Number.isSafeInteger(version) || version < 0 || version > 2_147_483_647) throw new Error("INCENTIVE_POLICY_INVALID_VERSION");
  const value = { merchantId, version, enabled: limits.enabled, limitCents: limits.limitCents,
    maxDiscountCents: limits.maxDiscountCents, maxRedemptions: limits.maxRedemptions };
  return { ...value, policyHash: digest({ definition: "merchant-incentive-policy-v1", ...value }) };
}
