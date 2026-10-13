import { BadRequestException } from "@nestjs/common";

export interface MerchantRetentionPolicy {
  mode: "delayed_merchant_payout";
  holdDays: 7;
  startsAt: "fulfillment";
  providerFeePayer: "merchant";
}

/** Server-owned opt-in; an unset policy preserves every existing payment rail. */
export function readMerchantRetentionPolicy(settings: unknown): MerchantRetentionPolicy | undefined {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return;
  const raw = (settings as Record<string, unknown>).paymentRetention;
  if (raw === undefined) return;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BadRequestException("merchant_retention_policy_invalid");
  const p = raw as Record<string, unknown>;
  if (p.mode !== "delayed_merchant_payout" || p.providerFeePayer !== "merchant" ||
      p.holdDays !== 7 || p.startsAt !== "fulfillment" || p.payoutDelayDays !== undefined) {
    throw new BadRequestException("merchant_retention_policy_invalid");
  }
  return { mode: "delayed_merchant_payout", holdDays: 7, startsAt: "fulfillment", providerFeePayer: "merchant" };
}

/** Store processing costs come from the PSP receipt, never an estimated rate. */
export function retainedMerchantAllocation(grossCents: number, platformFeeCents: number, providerFeeCents: number) {
  if (![grossCents, platformFeeCents, providerFeeCents].every(v => Number.isSafeInteger(v) && v >= 0) || grossCents <= 0) {
    throw new Error("merchant_retention_amount_invalid");
  }
  const merchantNetCents = grossCents - platformFeeCents - providerFeeCents;
  if (merchantNetCents <= 0) throw new Error("merchant_retention_net_nonpositive");
  return { grossCents, platformFeeCents, providerFeeCents, merchantNetCents };
}

export function merchantRetentionDate(policy: MerchantRetentionPolicy, startedAt: Date) {
  if (!Number.isFinite(startedAt.getTime())) throw new Error("merchant_retention_start_invalid");
  return new Date(startedAt.getTime() + policy.holdDays * 86_400_000);
}
