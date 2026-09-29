export interface IncentivePolicy {
  merchantId: string;
  version: number;
  policyHash: string;
  enabled: boolean;
  limitCents: number;
  maxDiscountCents: number;
  maxRedemptions: number;
}
export type IncentivePolicyCommand = Pick<IncentivePolicy, "enabled" | "limitCents" | "maxDiscountCents" | "maxRedemptions">
  & { expectedVersion: number; requestKey: string };

export function validIncentivePolicy(value: unknown, merchantId: string): value is IncentivePolicy {
  if (!value || typeof value !== "object") return false;
  const p = value as IncentivePolicy;
  return p.merchantId === merchantId && Number.isSafeInteger(p.version) && p.version >= 0 && p.version <= 2147483647
    && typeof p.policyHash === "string" && /^[a-f0-9]{64}$/.test(p.policyHash) && typeof p.enabled === "boolean"
    && [p.limitCents, p.maxDiscountCents, p.maxRedemptions].every(n => Number.isSafeInteger(n) && n >= 0)
    && p.limitCents <= 2147483647 && p.maxDiscountCents <= p.limitCents && p.maxRedemptions <= 1000000
    && ((p.limitCents > 0 && p.maxDiscountCents > 0 && p.maxRedemptions > 0)
      || (!p.enabled && p.limitCents === 0 && p.maxDiscountCents === 0 && p.maxRedemptions === 0))
    && (p.version > 0 || (!p.enabled && p.limitCents === 0 && p.maxDiscountCents === 0 && p.maxRedemptions === 0));
}
